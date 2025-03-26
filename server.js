'use strict';

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
const http = createServer(app);

const io = new Server(http);

app.set('view engine', 'pug');
app.set('views', './views/pug');


const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI, // Replace with your MongoDB connection string
});

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false, 
    saveUninitialized: false, 
    cookie: { secure: false }, 
    store: sessionStore,
  })
);

app.use(passport.initialize());
app.use(passport.session());

io.use(
  passportSocketIo.authorize({
    key: 'connect.sid', 
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    passport: passport,
    cookieParser: cookieParser,
  })
);


app.use('/public', express.static(process.cwd() + '/public'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

myDB((client) => {
  return new Promise((resolve, reject) => {
    const myDataBase = client.db('database').collection('users');

    if (!myDataBase) {
      reject(new Error("Failed to get the database collection"));
    } else {
      resolve(myDataBase);
    }
  })
    .then((myDataBase) => {
      
      let currentUsers = 0;

      io.on('connection', (socket) => {
        ++currentUsers;
        
        io.emit('user', {
          username: socket.request.user.username,
          currentUsers,
          connected: true,
        });
      
        console.log(`${socket.request.user.username} connected`);
      
        socket.on('disconnect', () => {
          --currentUsers;
      
          io.emit('user', {
            username: socket.request.user.username,
            currentUsers,
            connected: false,
          });
      
          console.log(`${socket.request.user.username} disconnected`);
        });
      
        socket.on('chat message', (message) => {
          io.emit('chat message', {
            username: socket.request.user.username,
            message,
          });
        });
      });
      

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

      passport.use(new LocalStrategy((username, password, done) => {
        console.log("Attempting login with", username, password);

        myDataBase.findOne({ username: username })
        .then((user) => {
          if (!user) {
            console.log("User not found");  
            console.log(user);
            displayMessage = 'Invalid username or password';
            return done(null, false);
          }

          if (!bcrypt.compareSync(password, user.password)) {
            console.log("Password mismatch");  
            displayMessage = 'Invalid username or password';
            return done(null, false);
          }

          console.log("Authentication successful"); 
          return done(null, user);
        })
        .catch((err) => {
          console.error("Error during authentication", err); 
          return done(err);
        });
    }));

      
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


      app.route('/login')
      .post(passport.authenticate('local', {
        successRedirect: '/profile', 
        failureRedirect: '/',
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
                $set: {
                  last_login: new Date()
                },
                $inc: {
                  login_count: 1
                }
              },
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

        app.use((req, res, next) => {
          res.status(404)
            .type('text')
            .send('Not Found');
        });
    })
    .catch((e) => {
      app.route('/').get((req, res) => {
        res.render('index', { title: e.message, message: 'Unable to connect to database' });
      });
    });
})


const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
