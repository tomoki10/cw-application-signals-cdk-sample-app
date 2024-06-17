import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ssm from "aws-cdk-lib/aws-ssm";

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
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		// ボリュームの作成
		serviceTaskDefinition.addVolume({
			name: "opentelemetry-auto-instrumentation-python",
		});

		const mainContainer = serviceTaskDefinition.addContainer(
			`${id}-ServiceTaskContainerDefinition`,
			{
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
				environment: {
					// Example: https://github.com/aws-observability/application-signals-demo/blob/main/pet_clinic_insurance_service/ec2-setup.sh
					OTEL_RESOURCE_ATTRIBUTES: `service.name=APM_SAMPLE,aws.log.group.names=${logGroup.logGroupName}`,
					OTEL_AWS_APPLICATION_SIGNALS_ENABLED: "true",
					OTEL_METRICS_EXPORTER: "none",
					OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
					// If sending metrics to the CloudWatch sidecar, configure: http://127.0.0.1:4316/v1/metrics
					OTEL_AWS_APPLICATION_SIGNALS_EXPORTER_ENDPOINT:
						"http://127.0.0.1:4316/v1/metrics",
					// If sending traces to the CloudWatch sidecar, configure: http://localhost:4316/v1/traces
					OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4316/v1/traces",
					// See: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Configure.html
					OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
					OTEL_TRACES_SAMPLER_ARG: "0.05",
					// OTEL_PROPAGATORS: "",
					OTEL_PYTHON_DISTRO: "aws_distro",
					OTEL_PYTHON_CONFIGURATOR: "aws_configurator", // docsはaws_configuration
					PYTHONPATH:
						"/otel-auto-instrumentation-python/opentelemetry/instrumentation/auto_instrumentation:/code/app:/otel-auto-instrumentation-python",
					// DJANGO_SETTINGS_MODULE: "", // Not Django
				},
			},
		);
		mainContainer.addPortMappings({
			containerPort: 80,
			hostPort: 80,
			protocol: ecs.Protocol.TCP,
		});
		mainContainer.addMountPoints({
			sourceVolume: "opentelemetry-auto-instrumentation-python",
			containerPath: "/otel-auto-instrumentation-python",
			readOnly: false,
		});

		// --- ecs-cwagent ---
		serviceTaskDefinition.addContainer(`${id}-CwAgentContainerDefinition`, {
			image: ecs.ContainerImage.fromRegistry(
				// See: https://gallery.ecr.aws/cloudwatch-agent/cloudwatch-agent
				"public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest-amd64",
			),
			secrets: {
				CW_CONFIG_CONTENT: ecs.Secret.fromSsmParameter(
					ssm.StringParameter.fromStringParameterName(
						this,
						"CWConfigParameter",
						"ecs-cwagent",
					),
				),
			},
			logging: ecs.LogDrivers.awsLogs({
				streamPrefix: "ecs",
				logGroup: new cdk.aws_logs.LogGroup(this, "LogGroup", {
					logGroupName: "/ecs/ecs-cwagent",
					removalPolicy: cdk.RemovalPolicy.DESTROY,
				}),
			}),
		});

		// --- init ---
		serviceTaskDefinition
			.addContainer("InitContainer", {
				image: ecs.ContainerImage.fromRegistry(
					// See: https://gallery.ecr.aws/aws-observability/adot-autoinstrumentation-python
					"public.ecr.aws/aws-observability/adot-autoinstrumentation-python:v0.2.0",
				),
				essential: false,
				command: [
					"cp",
					"-a",
					"/autoinstrumentation/.",
					"/otel-auto-instrumentation-python",
				],
			})
			.addMountPoints({
				sourceVolume: "opentelemetry-auto-instrumentation-python",
				containerPath: "/otel-auto-instrumentation-python",
				readOnly: false,
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

		new cdk.CfnOutput(this, "LOAD_BALANCER_DNS_NAME", {
			value: albForApp.loadBalancerName,
		});
	}
}
