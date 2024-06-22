import * as cdk from "aws-cdk-lib";
import { aws_ecr as ecr } from "aws-cdk-lib";
import type { Construct } from "constructs";

export class EcrStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id);

    // --- ECR ---

    // Create a repository
    const repository = new ecr.Repository(this, "apm-sample", {
      repositoryName: "apm-test",
      imageTagMutability: ecr.TagMutability.MUTABLE, // not recommended
    });
    repository.addLifecycleRule({ maxImageCount: 3 });
  }
}
