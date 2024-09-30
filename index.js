const admin = require('firebase-admin');
const dotenv = require('dotenv');
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer'); // Add nodemailer for sending emails

dotenv.config();  // Load environment variables from .env

// Initialize Firebase Admin SDK using environment variables
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
  }),
  databaseURL: "https://kings-cogent-finance-ltd-ecab6.firebaseio.com"
});

const firestore = admin.firestore();
const app = express();
app.use(bodyParser.json());

const FLUTTERWAVE_SECRET_HASH = process.env.FLUTTERWAVE_SECRET_HASH;

// Configure Nodemailer transporter for email notifications
const transporter = nodemailer.createTransport({
  service: 'gmail',  // You can replace 'gmail' with other services like 'SendGrid' or custom SMTP
  auth: {
    user: process.env.SMTP_USER,  // Use email from .env file
    pass: process.env.SMTP_PASS   // Use password from .env file (App Password if Gmail)
  }
});

app.post('/flutterwave-webhook', async (req, res, next) => {
  const flutterwaveSignature = req.headers['verif-hash'];

  if (!flutterwaveSignature || flutterwaveSignature !== FLUTTERWAVE_SECRET_HASH) {
    return res.status(401).send('Unauthorized');
  }

  const event = req.body;

  try {
    const txRef = event?.data?.tx_ref;
    const email = event?.data?.customer?.email;
    const status = event?.data?.status;
    const amount = event?.data?.amount;
    const transactionDate = new Date().toLocaleString();

    // Log transaction details for debugging
    console.log('Transaction Reference (txRef):', txRef);
    console.log('User Email:', email);
    console.log('Transaction Amount:', amount);
    console.log('Transaction Status:', status);

    // Retrieve the user by email to get their UID
    const usersRef = firestore.collection('users');
    const querySnapshot = await usersRef.where('email', '==', email).get();

    if (querySnapshot.empty) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Assume the first user document found corresponds to the email
    const userDoc = querySnapshot.docs[0];
    const uid = userDoc.id;

    // Transaction data to be updated with the new status
    const transactionData = {
      status: status,
      amount: amount,
      updated_at: new Date().toISOString(),
    };

    // Update the transaction status under the user's UID
    await firestore
      .collection('users')
      .doc(uid)
      .collection('transactions')
      .doc(txRef)
      .set(transactionData, { merge: true });

    // Retrieve the FCM token from the user's document
    const userData = userDoc.data();
    const fcmToken = userData.fcmToken;

    const notificationData = {
      title: `Transaction ${status}`,
      body: `Amount: ${amount}\nReference: ${txRef}\nDate: ${transactionDate}\nStatus: ${status}`,
      tx_ref: txRef,
      amount: amount,
      status: status,
      timestamp: new Date(),
      read: false  // Mark notification as unread initially
    };

    // Store the notification in the Firestore subcollection
    await firestore.collection('users').doc(uid).collection('notifications').add(notificationData);

    // Send FCM notification if FCM token is available
    if (fcmToken) {
      const message = {
        notification: {
          title: `Transaction ${status}`,
          body: `Amount: ${amount}\nReference: ${txRef}\nDate: ${transactionDate}\nStatus: ${status}`,
        },
        token: fcmToken,
      };

      await admin.messaging().send(message)
        .then((response) => {
          console.log('Notification sent successfully:', response);
        })
        .catch((error) => {
          console.error('Error sending notification:', error);
        });
    } else {
      console.log("FCM token not found for user, notification not sent.");
    }

    // ** Send Email Notification using Nodemailer **
    const mailOptions = {
      from: process.env.SMTP_USER,  // Sender email from .env file
      to: email,                    // Receiver's email (customer email)
      subject: 'KcfApp Transaction Notification',
      html: `
        <h1>KcfApp Transaction</h1>
        <p>Amount: ${amount}</p>
        <p>Currency: ${event.data.currency}</p>
        <p>Status: ${status}</p>
        <p>Transaction Reference: ${txRef}</p>
        <p>Date: ${transactionDate}</p>
        <p>Thank you for Using the KcfApp.</p>
      `
    };

    // Send the email using nodemailer
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending email:', error);
      } else {
        console.log('Email sent successfully:', info.response);
      }
    });

    return res.status(200).send('Transaction updated and email sent successfully');
  } catch (error) {
    console.error('Error storing transaction:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// Test route
app.post('/test', async (req, res, next) => {
  try {
    return res.status(200).send('This is working');
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).send('Internal Server Error');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
