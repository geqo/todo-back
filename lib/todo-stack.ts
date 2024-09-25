import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
/*
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
 */

export class TodoStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const table = new dynamodb.Table(this, 'TodoTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableName: 'todos',
            removalPolicy: cdk.RemovalPolicy.DESTROY, // for test only
        });

        const todoLambda = new NodejsFunction(this, 'TodoLambda', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../src/index.ts'),
            environment: {
                TABLE_NAME: table.tableName,
            },
            bundling: {
                externalModules: ['aws-sdk'], // Exclude 'aws-sdk' since it's available in Lambda runtime
            },
        });

        table.grantReadWriteData(todoLambda);

        const api = new apigateway.LambdaRestApi(this, 'TodoApi', {
            handler: todoLambda,
            proxy: false
        });

        const todos = api.root.addResource('todos');
        todos.addMethod('GET');    // GET /todos
        todos.addMethod('POST');   // POST /todos

        const singleTodo = todos.addResource('{id}');
        singleTodo.addMethod('GET');    // GET /todos/{id}
        singleTodo.addMethod('PUT');    // PUT /todos/{id}
        singleTodo.addMethod('DELETE'); // DELETE /todos/{id}
/*
        const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
            websiteIndexDocument: 'index.html',
            publicReadAccess: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // for test only
        });

        new s3deploy.BucketDeployment(this, 'DeployWebsite', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '../frontend'))],
            destinationBucket: frontendBucket,
            retainOnDelete: false,
        });

        new cdk.CfnOutput(this, 'WebsiteUrl', {
            value: frontendBucket.bucketWebsiteUrl,
            description: 'The test URL',
        });
 */
    }
}
