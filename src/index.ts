import express from 'express';
import serverless from 'serverless-http';
import {
    DeleteItemCommand,
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand
} from '@aws-sdk/client-dynamodb';
import {ScanCommand} from "@aws-sdk/lib-dynamodb";

const app = express();
app.use(express.json());

const dynamoDb = new DynamoDBClient({ region: 'us-east-1' });

const TABLE_NAME = process.env.TABLE_NAME!;

app.get('/todos', async (req, res) => {
    try {
        const result = await dynamoDb.send(new ScanCommand({TableName: TABLE_NAME}));
        res.status(200).json(result.Items);
    } catch (error) {
        res.status(500).json({ error: 'Could not retrieve todos' });
    }
});

app.post('/todos', async (req, res) => {
    const { task } = req.body;

    if (! task) {
        return res.status(400).json({ error: 'Task required' });
    }

    const params = {
        TableName: TABLE_NAME,
        Item: {
            id: { S: new Date().toISOString() },
            task: { S: task }
        }
    };

    try {
        await dynamoDb.send(new PutItemCommand(params));
        return res.status(201).json({
            id: params.Item.id.S,
            task: params.Item.task.S
        });
    } catch (error) {
        return res.status(500).json({ error: 'Could not create todo', exception: error });
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
            return res.status(200).json(result.Item);
        } else {
            return res.status(404).json({ error: 'Todo not found' });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Could not retrieve todo', exception: error });
    }
});

app.put('/todos/:id', async (req, res) => {
    const { id } = req.params;
    const { task } = req.body;

    if (! id || ! task) {
        return res.status(400).json({ error: 'Id and task are required' });
    }

    const params = {
        TableName: TABLE_NAME,
        Key: {
            id: { S: id }
        },
        UpdateExpression: 'set task = :task',
        ExpressionAttributeValues: {
            ':task': { S: task }
        },
        ReturnValues: 'UPDATED_NEW' as const
    };

    try {
        const result = await dynamoDb.send(new UpdateItemCommand(params));
        return res.status(200).json(result.Attributes);
    } catch (error) {
        return res.status(500).json({ error: 'Could not update todo', exception: error });
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
        res.status(500).json({ error: 'Could not delete todo', exception: error });
    }
});

export const handler = serverless(app);

/*
app.listen(3000, () => {
    console.log(`Server is running on http://localhost:3000`);
});
*/
