
## Setup

### Local
https://fastapi.tiangolo.com/ja/deployment/docker/

docker build -t fastapi-sample:test .
docker run -d -p 8080:80 fastapi-sample:test  

### AWS
export IMAGE_TAG=latest
export REPOSITORY_NAME=apm-test
export AWS_ACCOUNT_ID=123456789012
export REGISTRY_NAME=$AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com
docker build --platform=linux/x86_64 -t $IMAGE_TAG .

docker tag $IMAGE_TAG $REGISTRY_NAME/$REPOSITORY_NAME

# require assume-role or other
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin $REGISTRY_NAME
docker push "$AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com/$REPOSITORY_NAME:$IMAGE_TAG"

## Application Signals Setup

https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-ECS.html