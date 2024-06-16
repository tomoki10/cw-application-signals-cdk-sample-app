import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";

export class ApplicationSignalsSampleStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		const natProvider = ec2.NatProvider.instanceV2({
			instanceType: ec2.InstanceType.of(
				ec2.InstanceClass.T4G,
				ec2.InstanceSize.NANO,
			),
			machineImage: ec2.MachineImage.latestAmazonLinux2023({
				cpuType: ec2.AmazonLinuxCpuType.ARM_64,
			}),
			defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
		});

		const myVpc = new ec2.Vpc(this, `${id}-Vpc`, {
			ipAddresses: ec2.IpAddresses.cidr("10.100.0.0/16"),
			maxAzs: 2,
			natGateways: 1,
			natGatewayProvider: natProvider,
			subnetConfiguration: [
				{
					cidrMask: 24,
					name: "Public",
					subnetType: ec2.SubnetType.PUBLIC,
				},
				{
					cidrMask: 24,
					name: "Protected",
					subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
				},
			],
		});
		natProvider.securityGroup.addIngressRule(
			ec2.Peer.ipv4(myVpc.vpcCidrBlock),
			ec2.Port.allTraffic(),
		);

		const securityGroupForAlb = new ec2.SecurityGroup(this, `${id}-SgAlb`, {
			vpc: myVpc,
			allowAllOutbound: false,
		});
		securityGroupForAlb.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
		securityGroupForAlb.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTcp());
		const securityGroupForFargate = new ec2.SecurityGroup(
			this,
			`${id}-SgFargate`,
			{
				vpc: myVpc,
				allowAllOutbound: false,
			},
		);
		securityGroupForFargate.addIngressRule(
			securityGroupForAlb,
			ec2.Port.tcp(80),
		);
		securityGroupForFargate.addEgressRule(
			ec2.Peer.anyIpv4(),
			ec2.Port.allTcp(),
		);

		// ALB for App Server
		const albForApp = new elbv2.ApplicationLoadBalancer(this, `${id}-Alb`, {
			vpc: myVpc,
			internetFacing: true,
			securityGroup: securityGroupForAlb,
			vpcSubnets: myVpc.selectSubnets({
				subnetGroupName: "Public",
			}),
		});

		// ECS

		// Roles
		const executionRole = new iam.Role(this, `${id}-EcsTaskExecutionRole`, {
			assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
			managedPolicies: [
				iam.ManagedPolicy.fromAwsManagedPolicyName(
					"service-role/AmazonECSTaskExecutionRolePolicy",
				),
			],
		});
		const serviceTaskRole = new iam.Role(this, `${id}-EcsServiceTaskRole`, {
			assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
			managedPolicies: [
				iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMFullAccess"),
				iam.ManagedPolicy.fromAwsManagedPolicyName(
					"CloudWatchAgentServerPolicy",
				),
			],
		});

		// --- Fargate Cluster ---
		// ECS Task
		const serviceTaskDefinition = new ecs.FargateTaskDefinition(
			this,
			`${id}-ServiceTaskDefinition`,
			{
				cpu: 256,
				memoryLimitMiB: 512,
				executionRole: executionRole,
				taskRole: serviceTaskRole,
			},
		);

		const logGroup = new logs.LogGroup(this, `${id}-ServiceLogGroup`, {
			retention: logs.RetentionDays.THREE_MONTHS,
			removalPolicy: cdk.RemovalPolicy.RETAIN,
		});

		serviceTaskDefinition
			.addContainer(`${id}-ServiceTaskContainerDefinition`, {
				image: ecs.ContainerImage.fromEcrRepository(
					ecr.Repository.fromRepositoryName(
						this,
						`${id}-RepositoryName`,
						"apm-test",
					),
					"latest", // not recommended
				),
				logging: ecs.LogDriver.awsLogs({
					streamPrefix: "ApmSample",
					logGroup,
				}),
			})
			.addPortMappings({
				containerPort: 80,
				hostPort: 80,
				protocol: ecs.Protocol.TCP,
			});

		// Cluster
		const cluster = new ecs.Cluster(this, `${id}-Cluster`, {
			vpc: myVpc,
			containerInsights: true,
		});

		const fargateService = new ecs.FargateService(
			this,
			`${id}-FargateService`,
			{
				cluster,
				vpcSubnets: myVpc.selectSubnets({ subnetGroupName: "Protected" }),
				securityGroups: [securityGroupForFargate],
				taskDefinition: serviceTaskDefinition,
				desiredCount: 1,
				maxHealthyPercent: 200,
				minHealthyPercent: 50,
				enableExecuteCommand: true,
				circuitBreaker: {
					enable: true,
				},
			},
		);

		const albListener = albForApp.addListener(`${id}-AlbListener`, {
			port: 80,
		});
		//200
		const fromAppTargetGroup = albListener.addTargets(
			`${id}-FromAppTargetGroup`,
			{
				port: 80,
				targets: [fargateService],
				healthCheck: {
					enabled: true,
					path: "/health-check",
					healthyHttpCodes: "200", // See: /app/main.py
				},
			},
		);
	}
}
