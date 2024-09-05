const admin = require('firebase-admin');
const dotenv = require('dotenv');
const express = require('express');
const bodyParser = require('body-parser');

dotenv.config();

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: "https://kings-cogent-finance-ltd-ecab6.firebaseio.com"
});

const firestore = admin.firestore();
const app = express();
app.use(bodyParser.json());

const FLUTTERWAVE_SECRET_HASH = process.env.FLUTTERWAVE_SECRET_HASH;

app.post('/flutterwave-webhook', async (req, res, next) => {
  const flutterwaveSignature = req.headers['verif-hash'];

  if (!flutterwaveSignature || flutterwaveSignature !== FLUTTERWAVE_SECRET_HASH) {
    return res.status(401).send('Unauthorized');
  }

  const event = req.body;

  try {
    const txRef = event?.data?.tx_ref;
    const uid = event?.data?.customer?.uid;

    // Validate txRef and uid before proceeding
    if (!txRef || typeof txRef !== 'string' || txRef.trim() === '') {
      return res.status(400).json({ error: 'Invalid transaction reference (tx_ref)' });
    }
    if (!uid || typeof uid !== 'string' || uid.trim() === '') {
      return res.status(400).json({ error: 'Invalid user ID (uid)' });
    }

    const transactionData = {
      tx_ref: txRef,
      amount: event.data.amount,
      currency: event.data.currency,
      status: event.data.status,
      date: new Date().toISOString(),
    };

    await firestore 
      .collection('users')
      .doc(uid)
      .collection('transactions')
      .doc(txRef)
      .set(transactionData);

    return res.status(200).send('Transaction stored successfully');
  } catch (error) {
    console.error('Error storing transaction:', error);
    return res.status(500).send('Internal Server Error');
  }
});

app.post('/test', async (req, res, next) => {
  try {
    return res.status(200).send('This is working');
  } catch (error) {
    console.error('Error storing transaction:', error);
    return res.status(500).send('Internal Server Error');
  }
})

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err); // Log the error
  res.status(500).send('Internal Server Error'); // Send a 500 response
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server is running on port ${PORT}');
});