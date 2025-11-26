const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/hibbett_monitor';
const client = new MongoClient(MONGO_URI);

async function removeLastEntries() {
  const args = process.argv.slice(2);
  const count = parseInt(args[0], 10);

  if (isNaN(count) || count <= 0) {
    console.error('Please provide a valid number of entries to remove. Usage: node removeLastEntries.js <number>');
    process.exit(1);
  }

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const database = client.db('hibbett_monitor');
    const collection = database.collection('pages');

    // Find the most recent 'count' entries
    // We sort by _id descending which is roughly equivalent to insertion time, 
    // or we can use the timestamp field if we want strictly by the logical timestamp.
    // Using timestamp field as it is explicit in the application logic.
    const recentDocs = await collection.find()
      .sort({ timestamp: -1 }) 
      .limit(count)
      .toArray();

    if (recentDocs.length === 0) {
      console.log('No entries found to delete.');
      return;
    }

    const idsToDelete = recentDocs.map(doc => doc._id);
    
    console.log(`Found ${idsToDelete.length} entries to delete.`);

    const result = await collection.deleteMany({
      _id: { $in: idsToDelete }
    });

    console.log(`Successfully deleted ${result.deletedCount} entries.`);

  } catch (error) {
    console.error('Error removing entries:', error);
  } finally {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

removeLastEntries();
