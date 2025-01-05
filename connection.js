import { MongoClient } from 'mongodb';

function main(callback) {
  const URI = process.env.MONGO_URI; // Ensure MONGO_URI is defined in your .env file
  if (!URI) {
    throw new Error('MONGO_URI is not defined in the environment variables');
  }

  const client = new MongoClient(URI);

  // Connect to MongoDB
  console.log('Connecting to MongoDB...');
  client.connect()
    .then(() => {
      console.log('Successfully connected to MongoDB');

      // Perform the database operations provided in the callback
      return callback(client);  // Calls the callback with the client
    })
    .catch((e) => {
      // Catch and log any errors
      console.error('Database connection error:', e.message);
      throw new Error('Unable to connect to the database');
    });
}

export default main;
