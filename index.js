require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

//middleware
app.use(cors());
app.use(express.json());

// ========
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-admin-service-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// ========

//verify Firebase Token
const verifyFirebaseToken = async (req, res, next) => {
  const autHeader = req.headers?.authorization;
  // console.log(autHeader);
  if (!autHeader || !autHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "authorized access" });
  }
  const token = autHeader.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    // console.log("decoded token", decoded);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_user}:${process.env.DB_PASS}@cluster0.cs0iy.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const tutorialsCollection = client
      .db("Language-School")
      .collection("tutorials");
    const bookingsCollection = client
      .db("Language-School")
      .collection("bookings");
    const reviewsCollection = client
      .db("Language-School")
      .collection("reviews");

    // Get tutorials by email
    // Get all tutorials, filter by email if provided

    app.get("/tutorials", async (req, res) => {
      try {
        const email = req.query.email;
        let query = {};
        if (email) {
          query.email = email;
        }
        const tutorials = await tutorialsCollection.find(query).toArray();
        res.send(tutorials);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get tutorials by language category
    app.get("/tutorials/category/:language", async (req, res) => {
      const tutorials = await tutorialsCollection
        .find({ language: req.params.language })
        .toArray();
      res.send(tutorials);
    });

    // Get tutorial details by ID
    app.get("/tutorials/:id", verifyFirebaseToken, async (req, res) => {
      const tutorial = await tutorialsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(tutorial);
    });

    // Add a new tutorial
    app.post("/tutorials", verifyFirebaseToken, async (req, res) => {
      const newTutorial = req.body;
      // Attach the logged-in user's email
      newTutorial.email = req.decoded.email;
      const result = await tutorialsCollection.insertOne(newTutorial);
      res.send(result);
    });

    // Book a tutor
    app.post("/bookings", async (req, res) => {
      const newBooking = req.body;
      const result = await bookingsCollection.insertOne(newBooking);
      res.send(result);
    });

    // Get all booked tutors for a user
    app.get("/bookings", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      const bookings = await bookingsCollection.find({ email }).toArray();
      res.send(bookings);
    });

    // Increase review count for a tutor
    app.patch("/tutorials/:id/review", async (req, res) => {
      const result = await tutorialsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $inc: { review: 1 } }
      );
      res.send(result);
    });

    // Update a tutorial
    app.put("/tutorials/:id", async (req, res) => {
      const updatedData = req.body;
      const result = await tutorialsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updatedData }
      );
      res.send(result);
    });

    // Delete a tutorial
    app.delete("/tutorials/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await tutorialsCollection.deleteOne(query);
      res.send(result);
    });

    // ========== REVIEW SYSTEM API ENDPOINTS ==========

    // Get reviews for a specific tutor
    app.get("/reviews/:tutorId", async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find({ tutorId: req.params.tutorId })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(reviews);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Add a new review
    app.post("/reviews", verifyFirebaseToken, async (req, res) => {
      try {
        const newReview = {
          ...req.body,
          reviewerEmail: req.decoded.email,
          reviewerName: req.decoded.name || req.decoded.email,
          createdAt: new Date()
        };
        
        const result = await reviewsCollection.insertOne(newReview);
        
        // Update tutor's average rating
        await updateTutorRating(req.body.tutorId);
        
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Update tutor's average rating
    const updateTutorRating = async (tutorId) => {
      try {
        const reviews = await reviewsCollection.find({ tutorId }).toArray();
        if (reviews.length > 0) {
          const averageRating = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
          await tutorialsCollection.updateOne(
            { _id: new ObjectId(tutorId) },
            { $set: { averageRating: Math.round(averageRating * 10) / 10, totalReviews: reviews.length } }
          );
        }
      } catch (error) {
        console.error("Error updating tutor rating:", error);
      }
    };

    // Get user's reviews
    app.get("/reviews/user/:email", verifyFirebaseToken, async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find({ reviewerEmail: req.params.email })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(reviews);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Update a review
    app.put("/reviews/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const reviewId = req.params.id;
        const updatedData = req.body;
        
        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(reviewId), reviewerEmail: req.decoded.email },
          { $set: { ...updatedData, updatedAt: new Date() } }
        );
        
        if (result.modifiedCount > 0) {
          // Update tutor's average rating
          const review = await reviewsCollection.findOne({ _id: new ObjectId(reviewId) });
          if (review) {
            await updateTutorRating(review.tutorId);
          }
        }
        
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Delete a review
    app.delete("/reviews/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const reviewId = req.params.id;
        
        // Get review details before deletion
        const review = await reviewsCollection.findOne({ _id: new ObjectId(reviewId) });
        
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(reviewId),
          reviewerEmail: req.decoded.email
        });
        
        if (result.deletedCount > 0 && review) {
          // Update tutor's average rating
          await updateTutorRating(review.tutorId);
        }
        
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("hello world");
});

app.listen(port, () => {
  console.log(`Assignment server is running  port ${port}`);
});
