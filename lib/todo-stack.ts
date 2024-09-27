import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as customResources from 'aws-cdk-lib/custom-resources';

export class TodoStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const table = new dynamodb.Table(this, 'TodoTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            tableName: 'todos',
            removalPolicy: cdk.RemovalPolicy.DESTROY, // for test only
        });

        table.addGlobalSecondaryIndex({
            indexName: 'StatusIndex',
            partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        const todoLambda = new NodejsFunction(this, 'TodoLambda', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../src/index.ts'),
            environment: {
                TABLE_NAME: table.tableName,
            },
            bundling: {
                externalModules: ['aws-sdk'],
            },
        });

        table.grantReadWriteData(todoLambda);

        const api = new apigateway.LambdaRestApi(this, 'TodoApi', {
            handler: todoLambda,
            proxy: false,
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
            }
        });

        const todos = api.root.addResource('todos');
        todos.addMethod('GET');    // GET /todos
        todos.addMethod('POST');   // POST /todos

        const singleTodo = todos.addResource('{id}');
        singleTodo.addMethod('GET');    // GET /todos/{id}
        singleTodo.addMethod('PUT');    // PUT /todos/{id}
        singleTodo.addMethod('DELETE'); // DELETE /todos/{id}

        const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
            websiteIndexDocument: 'index.html',
            publicReadAccess: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS, // Нужно спросить
            removalPolicy: cdk.RemovalPolicy.DESTROY, // for test only
        });

        const distribution = new cloudfront.Distribution(this, 'distro', {
            defaultBehavior: {
                origin: new origins.S3StaticWebsiteOrigin(frontendBucket),
            },
        });

        new s3deploy.BucketDeployment(this, 'DeployWebsite', {
            sources: [s3deploy.Source.asset('D:\\Work\\aws\\todo-front\\build')],
            destinationBucket: frontendBucket,
            distribution,
            distributionPaths: ['/*'],
        });

        new cdk.CfnOutput(this, 'FrontendUrl', {
            value: distribution.distributionDomainName,
            description: 'Frontend URL',
        });

        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.url ?? 'Something went wrong with the deployment',
            description: 'API URL',
        });

        // В проде я бы придумал какой-нибудь механизм миграций, если его нет
        const updateLambda = new NodejsFunction(this, 'UpdateTodosLambda', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../src/updateTodosWithStatus.ts'),
            environment: {
                TABLE_NAME: table.tableName,
            },
            bundling: {
                externalModules: ['aws-sdk'],
            },
        });

        table.grantReadWriteData(updateLambda);

        const provider = new customResources.Provider(this, 'Provider', {
            onEventHandler: updateLambda,
        });

        new cdk.CustomResource(this, 'UpdateTodosResource', { serviceToken: provider.serviceToken });

    }
}
