import express, {NextFunction, Request, Response} from 'express';
import serverless from 'serverless-http';
import {
    DeleteItemCommand, DescribeTableCommand,
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand
} from '@aws-sdk/client-dynamodb';
import {QueryCommand, ScanCommand} from "@aws-sdk/lib-dynamodb";
import cors from 'cors';
import {CognitoJwtVerifier} from "aws-jwt-verify";
import {JwtPayload} from "aws-jwt-verify/jwt-model";
import {command} from "aws-cdk/lib/commands/docs";

declare module 'express-serve-static-core' {
    interface Request {
        user?: JwtPayload;
        userId?: string;
    }
}

const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());
app.options('*', cors(corsOptions));

const dynamoDb = new DynamoDBClient({ region: 'us-east-1' });

const TABLE_NAME = process.env.TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;
const CLIENT_ID = process.env.CLIENT_ID!;

const verifier = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID,
    clientId: CLIENT_ID,
    tokenUse: 'id',
});

const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (! token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        req.user = await verifier.verify(token);
        req.userId = req.user.sub;
        return next();
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized', errorData: error });
    }
};

app.use(authenticate);

app.get('/todos', async (req, res) => {
    const { status } = req.query;

    if (! req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // debug start
    const describeCommand = new DescribeTableCommand({
        TableName: TABLE_NAME
    });
    const describeResult = await dynamoDb.send(describeCommand);
    const getAllRecordsCommand = new ScanCommand({
        TableName: TABLE_NAME
    });
    const allRecords = await dynamoDb.send(getAllRecordsCommand);
    // debug end

    const params: any = {
        TableName: TABLE_NAME,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
            ':userId': req.userId,
        },
    };

    if (status) {
        params.FilterExpression = '#status = :status';
        params.ExpressionAttributeValues[':status'] = status;
        params.ExpressionAttributeNames = {
            '#status': 'status'
        };
    }

    try {
        const command = new QueryCommand(params);
        const result = await dynamoDb.send(command);
        return res.status(200).json(result.Items);
    } catch (error) {
        return res.status(500).json({
            error: 'Could not retrieve todos',
            errorData: error,
            debugData: {
                params: params,
                command: command,
                describe: describeResult,
                allRecords: allRecords
            }
        });
    }
});

app.post('/todos', async (req, res) => {
    const { task, status } = req.body;

    if (! task) {
        return res.status(400).json({ error: 'Task required' });
    }

    if (! req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const params = {
        TableName: TABLE_NAME,
        Item: {
            id: { S: new Date().toISOString() },
            userId: { S: req.userId },
            task: { S: task },
            status: { S: status || 'NEW' }
        }
    };

    try {
        await dynamoDb.send(new PutItemCommand(params));
        return res.status(201).json({
            id: params.Item.id.S,
            task: params.Item.task.S,
            status: params.Item.status.S
        });
    } catch (error) {
        return res.status(500).json({ error: 'Could not create todo' });
    }
});

app.get('/todos/:id', async (req, res) => {
    const { id } = req.params;

    if (! id) {
        return res.status(400).json({ error: 'Id required' });
    }

    const params = {
        TableName: TABLE_NAME,
        Key: {
            id: { S: id }
        },
    };

    try {
        const result = await dynamoDb.send(new GetItemCommand(params));
        if (result.Item && result.Item.userId.S === req.userId) {
            return res.status(200).json({
                id: result.Item.id.S,
                task: result.Item.task.S,
                status: result.Item.status?.S ?? 'none'
            });
        } else {
            return res.status(404).json({ error: 'Todo not found' });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Could not retrieve todo' });
    }
});

app.put('/todos/:id', async (req, res) => {
    const { id } = req.params;
    const { task, status } = req.body;

    if (! id || ! task) {
        return res.status(400).json({ error: 'Id and task are required' });
    }

    if (! req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const getParams = {
        TableName: TABLE_NAME,
        Key: {
            id: { S: id }
        }
    };

    try {
        const getResult = await dynamoDb.send(new GetItemCommand(getParams));
        if (! getResult.Item || getResult.Item.userId.S !== req.userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Could not verify todo ownership', errorData: error });
    }

    const updateParams: any = {
        TableName: TABLE_NAME,
        Key: {
            id: { S: id }
        },
        UpdateExpression: 'set task = :task',
        ExpressionAttributeValues: {
            ':task': { S: task }
        },
        ReturnValues: 'UPDATED_NEW'
    };

    if (status) {
        updateParams.UpdateExpression += ', #status = :status';
        updateParams.ExpressionAttributeValues[':status'] = { S: status };
        updateParams.ExpressionAttributeNames = {
            '#status': 'status'
        };
    }

    try {
        const result = await dynamoDb.send(new UpdateItemCommand(updateParams));
        return res.status(200).json(result.Attributes);
    } catch (error) {
        return res.status(500).json({ error: 'Could not update todo', errorData: error });
    }
});

app.delete('/todos/:id', async (req, res) => {
    const { id } = req.params;

    if (! req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const getParams = {
        TableName: TABLE_NAME,
        Key: {
            id: { S: id }
        }
    };

    try {
        const getResult = await dynamoDb.send(new GetItemCommand(getParams));
        if (! getResult.Item || getResult.Item.userId.S !== req.userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Could not delete todo', errorData: error });
    }

    const params = {
        TableName: TABLE_NAME,
        Key: {
            id: { S: id }
        }
    };

    try {
        await dynamoDb.send(new DeleteItemCommand(params));
        return res.status(204).send();
    } catch (error) {
        return res.status(500).json({ error: 'Could not delete todo' });
    }
});

export const handler = serverless(app);

/*
app.listen(3000, () => {
    console.log(`Server is running on http://localhost:3000`);
});
*/
