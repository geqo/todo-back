import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
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

export class TodoStackNew extends cdk.Stack {
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

        table.addGlobalSecondaryIndex({
            indexName: 'UserIdIndex',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // cognito
        const userPool = new cognito.UserPool(this, 'TodoUserPool', {
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            autoVerify: { email: true },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
        });

        const userPoolClient = new cognito.UserPoolClient(this, 'TodoUserPoolClient', {
            userPool,
        });

        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'TodoApiAuthorizer', {
            cognitoUserPools: [userPool],
        });

        const todoLambda = new NodejsFunction(this, 'TodoLambda', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../src/index.ts'),
            environment: {
                TABLE_NAME: table.tableName,
                USER_POOL_ID: userPool.userPoolId,
                CLIENT_ID: userPoolClient.userPoolClientId,
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
                allowHeaders: ['Content-Type', 'Authorization'],
            }
        });

        const authRole = new iam.Role(this, 'CognitoAuthRole', {
            assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
                'StringEquals': { 'cognito-identity.amazonaws.com:aud': userPoolClient.userPoolClientId },
            }, 'sts:AssumeRoleWithWebIdentity'),
        });

        const todos = api.root.addResource('todos');
        const singleTodo = todos.addResource('{id}');

        todos.addMethod('GET', new apigateway.LambdaIntegration(todoLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        todos.addMethod('POST', new apigateway.LambdaIntegration(todoLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        singleTodo.addMethod('GET', new apigateway.LambdaIntegration(todoLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        singleTodo.addMethod('PUT', new apigateway.LambdaIntegration(todoLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        singleTodo.addMethod('DELETE', new apigateway.LambdaIntegration(todoLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        // Outputs
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: userPool.userPoolId,
            description: 'Cognito User Pool ID',
        });

        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID',
        });

        // frontend
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

        const updateLambdaUserId = new NodejsFunction(this, 'UpdateTodosWithUserIdLambda', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../src/updateTodosWithUserId.ts'),
            environment: {
                TABLE_NAME: table.tableName,
            },
            bundling: {
                externalModules: ['aws-sdk'],
            },
        });

        table.grantReadWriteData(updateLambda);
        table.grantReadWriteData(updateLambdaUserId);

        const provider = new customResources.Provider(this, 'Provider', {
            onEventHandler: updateLambda,
        });

        new cdk.CustomResource(this, 'UpdateTodosResource', { serviceToken: provider.serviceToken });

    }
}
