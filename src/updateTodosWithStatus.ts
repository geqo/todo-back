import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const dynamoDb = new DynamoDBClient({ region: 'us-east-1' });
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async () => {
    const scanParams = {
        TableName: TABLE_NAME,
    };

    try {
        const scanResult = await dynamoDb.send(new ScanCommand(scanParams));
        const items = scanResult.Items ?? [];

        for (const item of items) {
            if (!item.status) {
                const updateParams = {
                    TableName: TABLE_NAME,
                    Key: {
                        id: item.id,
                    },
                    UpdateExpression: 'set #status = :status',
                    ExpressionAttributeNames: {
                        '#status': 'status',
                    },
                    ExpressionAttributeValues: {
                        ':status': { S: 'NEW' }, // Default status
                    },
                };

                await dynamoDb.send(new UpdateItemCommand(updateParams));
            }
        }

        console.log('All items updated with status');
    } catch (error) {
        console.error('Error updating items:', error);
    }
};
