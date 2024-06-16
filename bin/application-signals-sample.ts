#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ApplicationSignalsSampleStack } from "../lib/application-signals-sample-stack";
import { EcrStack } from "../lib/ecr-stack";

const app = new cdk.App();
new EcrStack(app, "EcrStack", {});

new ApplicationSignalsSampleStack(app, "ApplicationSignalsSampleStack", {});
