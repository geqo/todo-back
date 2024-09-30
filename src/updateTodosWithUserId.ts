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
        console.log(`Found ${items.length} items in the table.`); // Лог количества найденных элементов

        for (const item of items) {
            if (!item.userId) {
                const updateParams = {
                    TableName: TABLE_NAME,
                    Key: {
                        id: item.id,
                    },
                    UpdateExpression: 'set #userId = :userId',
                    ExpressionAttributeNames: {
                        '#userId': 'userId',
                    },
                    ExpressionAttributeValues: {
                        ':userId': { S: '0' },
                    },
                };

                await dynamoDb.send(new UpdateItemCommand(updateParams));
                console.log(`Updated item with id: ${item.id.S}`); // Лог обновленного элемента
            }
        }

        console.log('All items updated with userId.');
    } catch (error) {
        console.error('Error updating items:', error);
    }
};
