# CloudWatch Application Signals Sample App with AWS CDK

## Application Signals Setup

The AWS CDK describes the steps to build an application to try Application Signals based on the following instructions.

[Use a custom setup to enable Application Signals on Amazon ECS](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-ECS.html)

## Setup

### Local Container Development

The Dockerfile and sample apps are created using the following instructions.

[FastAPI in Containers - Docker](https://fastapi.tiangolo.com/deployment/docker/)

```
% docker build -t fastapi-sample:test .
% docker run -d -p 8080:80 fastapi-sample:test  
```

### AWS Deploy

#### ECR Deploy
```
% npx cdk deploy EcrStack --require-approval never
```

#### Push image to ECR
```
% export IMAGE_TAG=latest
% export REPOSITORY_NAME=apm-test
% export AWS_ACCOUNT_ID=123456789012
% export REGISTRY_NAME=$AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com
% docker build --platform=linux/x86_64 -t $IMAGE_TAG .

% docker tag $IMAGE_TAG $REGISTRY_NAME/$REPOSITORY_NAME

# require assume-role or other
% aws ecr get-login-password --region ap-northeast-1 | \
    docker login --username AWS --password-stdin $REGISTRY_NAME
% docker push "$AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com/$REPOSITORY_NAME:$IMAGE_TAG"
```

#### VPC and ECS other infra resource deploy
```
% npx cdk deploy ApplicationSignalsSampleStack --require-approval never
```
