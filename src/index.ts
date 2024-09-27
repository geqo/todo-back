import express from 'express';
import serverless from 'serverless-http';
import {
    DeleteItemCommand,
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand
} from '@aws-sdk/client-dynamodb';
import {QueryCommand, ScanCommand} from "@aws-sdk/lib-dynamodb";
import cors from 'cors';

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

app.get('/todos', async (req, res) => {
    const { status } = req.query;
    const params: any = {
        TableName: TABLE_NAME,
        IndexName: 'StatusIndex',
    }

    if (status) {
        params.KeyConditionExpression = '#status = :status';
        params.ExpressionAttributeNames = {
            '#status': 'status'
        };
        params.ExpressionAttributeValues = {
            ':status': status
        };
    }

    try {
        const command = status ? new QueryCommand(params) : new ScanCommand(params);
        const result = await dynamoDb.send(command);
        res.status(200).json(result.Items);
    } catch (error) {
        console.log(error);

        res.status(500).json({ error: 'Could not retrieve todos', errorData: error });
    }
});

app.post('/todos', async (req, res) => {
    const { task, status } = req.body;

    if (! task) {
        return res.status(400).json({ error: 'Task required' });
    }

    const params = {
        TableName: TABLE_NAME,
        Item: {
            id: { S: new Date().toISOString() },
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
        }
    };

    try {
        const result = await dynamoDb.send(new GetItemCommand(params));
        if (result.Item) {
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

    const params: any = {
        TableName: TABLE_NAME,
        Key: {
            id: { S: id }
        },
        UpdateExpression: 'set task = :task',
        ExpressionAttributeValues: {
            ':task': { S: task }
        },
        ExpressionAttributeNames: {
            '#status': 'status'
        },
        ReturnValues: 'UPDATED_NEW'
    };

    if (status) {
        params.UpdateExpression += ', #status = :status';
        params.ExpressionAttributeValues[':status'] = { S: status };
    }

    try {
        const result = await dynamoDb.send(new UpdateItemCommand(params));
        return res.status(200).json(result.Attributes);
    } catch (error) {
        return res.status(500).json({ error: 'Could not update todo', errorData: error });
    }
});

app.delete('/todos/:id', async (req, res) => {
    const { id } = req.params;

    const params = {
        TableName: TABLE_NAME,
        Key: {
            id: { S: id }
        }
    };

    try {
        await dynamoDb.send(new DeleteItemCommand(params));
        res.status(204).send();
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Could not delete todo' });
    }
});

export const handler = serverless(app);

/*
app.listen(3000, () => {
    console.log(`Server is running on http://localhost:3000`);
});
*/
