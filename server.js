'use strict';

// Import dependencies
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
dotenv.config();
import { ObjectId } from 'mongodb';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GitHubStrategy } from 'passport-github';
import express from 'express';
import passport from 'passport';
import session from 'express-session';
import passportSocketIo from 'passport.socketio';
import cookieParser from 'cookie-parser';
import MongoStore from 'connect-mongo';
import myDB from './connection.js';
import fccTesting from './freeCodeCamp/fcctesting.js';

const app = express();
// Create the HTTP server
const http = createServer(app);

// Initialize socket.io with the HTTP server
const io = new Server(http);

// Set up Pug as the template engine
app.set('view engine', 'pug');
app.set('views', './views/pug');

// Middleware for sessions

const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI, // Replace with your MongoDB connection string
});

// Middleware for passport
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false, // Avoid unnecessary resaves
    saveUninitialized: false, // Do not save empty sessions
    cookie: { secure: false }, // Set secure: true in production with HTTPS
    store: sessionStore,
  })
);

// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session());

io.use(
  passportSocketIo.authorize({
    key: 'connect.sid', // Default key for session ID in cookies
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    passport: passport,
    cookieParser: cookieParser,
  })
);


// Serve static files
app.use('/public', express.static(process.cwd() + '/public'));

// Middleware for parsing requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to the database using myDB
myDB((client) => {
  return new Promise((resolve, reject) => {
    // Wrap in a Promise to handle db and collection methods in a then/catch chain
    const myDataBase = client.db('database').collection('users');

    if (!myDataBase) {
      reject(new Error("Failed to get the database collection"));
    } else {
      resolve(myDataBase);
    }
  })
    .then((myDataBase) => {
      
      let currentUsers = 0;

      // To listen for connections to your server
      io.on('connection', (socket) => {
        ++currentUsers;
        
        // Notify all clients about the new user
        io.emit('user', {
          username: socket.request.user.username,
          currentUsers,
          connected: true,
        });
      
        console.log(`${socket.request.user.username} connected`);
      
        socket.on('disconnect', () => {
          --currentUsers;
      
          // Notify all clients about the disconnected user
          io.emit('user', {
            username: socket.request.user.username,
            currentUsers,
            connected: false,
          });
      
          console.log(`${socket.request.user.username} disconnected`);
        });
      
        // Handle chat messages
        socket.on('chat message', (message) => {
          // Broadcast the message to all clients
          io.emit('chat message', {
            username: socket.request.user.username,
            message,
          });
        });
      });
      

      // Route to display the index page with database connection status
      let displayMessage = 'Please login';
      app.route('/').get((req, res) => {
        res.render('index', {
          title: 'Connected to Database',
          message: displayMessage,
          showLogin: true,
          showRegistration: true,
          showSocialAuth: true,
        });
      });

      // Define the local strategy
      passport.use(new LocalStrategy((username, password, done) => {
        console.log("Attempting login with", username, password); // Debugging line

        // Search for user by username in the database
        myDataBase.findOne({ username: username })
        .then((user) => {
          if (!user) {
            console.log("User not found");  // Debugging line
            console.log(user);
            displayMessage = 'Invalid username or password';
            return done(null, false);
          }

          // If the user exists, check if the password matches
          if (!bcrypt.compareSync(password, user.password)) {
            console.log("Password mismatch");  // Debugging line
            displayMessage = 'Invalid username or password';
            return done(null, false);
          }

          console.log("Authentication successful");  // Debugging line
          return done(null, user); // Successful authentication
        })
        .catch((err) => {
          console.error("Error during authentication", err);  // Debugging line
          return done(err); // If there's an error in the database query
        });
    }));

      
      // Passport serialization and deserialization
      passport.serializeUser((user, done) => {
        done(null, user._id);
      });

      passport.deserializeUser((id, done) => {
        myDataBase
          .findOne({ _id: new ObjectId(id) })
          .then((doc) => {
            done(null, doc);
          })
          .catch((err) => {
            done(err);
          });
      });

      // Add other routes or middleware here as needed

      app.route('/login')
      .post(passport.authenticate('local', {
        successRedirect: '/profile', // Redirect on success
        failureRedirect: '/', // Redirect on failure
      }));

      function ensureAuthenticated(req, res, next) {
        if (req.isAuthenticated()) {
          return next();
        }
        res.redirect('/');
      };

      app.route('/profile').get(ensureAuthenticated, (req, res) => {
        res.render('profile', {
          username: req.user.username,
        });
      });

      app.route('/logout')
      .get((req, res) => {
        req.logout((err, next) => {
          if (err) {
            console.error('Error during logout:', err);
            return next(err);
          }
          console.log('User logged out successfully');
        });
        res.redirect('/');
        });
        
        app.route('/register').post((req, res, next) => {
          const username = req.body.username;
          const password = req.body.password;
          const hash = bcrypt.hashSync(password, 12);

          myDataBase.findOne({ username:username })
          .then((foundUser) => {
            console.log(foundUser)
            if(foundUser) {
              console.log('User already exists!!');
              res.redirect('/');
            }
            else{
              const newUser = { username: username, password: hash };
              myDataBase.insertOne(newUser)
              .then((user) => {
                console.log(`${username} successfully added!!`);

                 // Fetch the new user to include the _id field
                myDataBase.findOne({ username: username })
                .then((newUser) => {
                  req.login(newUser, (err) => {
                    if (err) {
                      console.error('Error during login:', err);
                      return next(err);
                    }
                    res.redirect('/profile');
                  });
                });
              })
              .catch((err) => {
                console.log(`Error inserting ${username}`);
                next(err)
              });
            }
          })
          .catch((err) => {
            next(err)
          });
        });

        passport.use(new GitHubStrategy(
          {
            clientID: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackURL: "https://diego-establishment-all-emission.trycloudflare.com/auth/github/callback",
          },
          (accessToken, refreshToken, profile, done) => {
            myDataBase.findOneAndUpdate(
              { id: profile.id },
              {
                // Fields under $setOnInsert are only applied if a new document is created (inserted due to upsert: true).
                $setOnInsert: {
                  id: profile.id,
                  username: profile.username,
                  name: profile.displayName || 'Anonymous',
                  photo: profile.photos?.[0]?.value || '',
                  email: Array.isArray(profile.emails)
                    ? profile.emails[0].value
                    : 'No public email',
                  created_on: new Date(),
                  provider: profile.provider || ''
                },
                // Fields under $set are applied every time the query runs, whether it's an update or an insert.
                $set: {
                  last_login: new Date()
                },
                // Increments the login_count field by 1 each time the query runs.
                $inc: {
                  login_count: 1
                }
              },
              // upsert: true: If no matching document is found, insert a new one.
              // new: true: Ensures the returned document is the newly updated version (with changes applied).
              { upsert: true, new: true }
            )
            .then((doc) =>{
              myDataBase.findOne({ id:doc.id })
              .then((doc) => {
                return done(null, doc)
              })
              .catch(e => done(e));
            })
            .catch(e => done(e));
          }
        ))

        app.route('/auth/github').get(passport.authenticate('github'));

        app.route('/auth/github/callback').get(
          passport.authenticate('github', {
            successRedirect: '/chat',
            failureRedirect: '/',
          }
        ));
        
        app.route('/chat').get(ensureAuthenticated, (req, res) => {
          res.render('chat', {
            username: req.user.username,
          });
        });

        // Add this middleware after all routes
        app.use((req, res, next) => {
          res.status(404)
            .type('text')
            .send('Not Found');
        });
    })
    .catch((e) => {
      // Handle database connection errors
      app.route('/').get((req, res) => {
        res.render('index', { title: e.message, message: 'Unable to connect to database' });
      });
    });
})


// Start the server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
