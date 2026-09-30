const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();

// --- MIDDLEWARES ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// =========================================================================
// 1. HARDCODED FIREBASE CREDENTIALS & INITIALIZATION
// =========================================================================
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDN_Gg1K4rUuP9WhwuZp44YgDABA0o4sKU",
    authDomain: "chattrix-d2897.firebaseapp.com",
    projectId: "chattrix-d2897",
    storageBucket: "chattrix-d2897.firebasestorage.app",
    messagingSenderId: "630181045497",
    appId: "1:630181045497:web:48aff416562d4b559c2e28",
    measurementId: "G-9P6PMGWYS2"
};

// Initialize Firebase Admin on the server
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: FIREBASE_CONFIG.projectId,
        storageBucket: FIREBASE_CONFIG.storageBucket
    });
    console.log('[FIREBASE] Admin initialized on Node.js server for project:', FIREBASE_CONFIG.projectId);
}

// =========================================================================
// 2. HARDCODED CLOUDINARY CONFIGURATION
// =========================================================================
cloudinary.config({
    cloud_name: 'qgtma8wv',
    api_key: '226171487848885',
    api_secret: 'MSJO8EKk5EnrCMp4hgQouDMl3bw'
});

// Multer memory storage for direct streaming to Cloudinary
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB media limit
});

// =========================================================================
// 3. HARDCODED MONGODB CONNECTION
// =========================================================================
const MONGO_URI = "mongodb://jerrychukwuwikeifeadike_db_user:TopOWzZlWeXQjReV@ac-pwlwuez-shard-00-00.6ds1owy.mongodb.net:27017,ac-pwlwuez-shard-00-01.6ds1owy.mongodb.net:27017,ac-pwlwuez-shard-00-02.6ds1owy.mongodb.net:27017/?ssl=true&replicaSet=atlas-127iwj-shard-0&authSource=admin&appName=Cluster0";

mongoose.connect(MONGO_URI, {
    dbName: 'tiktok_feed_db'
})
.then(() => console.log('[DATABASE] MongoDB Connected Successfully'))
.catch(err => console.error('[DATABASE] MongoDB Connection Error:', err));

// =========================================================================
// 4. MONGOOSE SCHEMAS & MODELS
// =========================================================================

// Post Schema
const PostSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    username: { type: String, required: true },
    userAvatar: { type: String, default: '' },
    mediaUrl: { type: String, required: true },
    mediaType: { type: String, enum: ['video', 'image'], default: 'video' },
    description: { type: String, default: '' },
    likes: { type: [String], default: [] },       // Array of Firebase UIDs
    favorites: { type: [String], default: [] },   // Array of Firebase UIDs
    sharesCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

// Comment Schema
const CommentSchema = new mongoose.Schema({
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    userAvatar: { type: String, default: '' },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

// User Profile Schema
const UserProfileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    displayName: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    avatar: { type: String, default: '' },
    bio: { type: String, default: 'No bio yet.' },
    followers: { type: [String], default: [] },
    following: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', PostSchema);
const Comment = mongoose.model('Comment', CommentSchema);
const UserProfile = mongoose.model('UserProfile', UserProfileSchema);


// =========================================================================
// 5. SERVER-SIDE FIREBASE AUTHENTICATION ENDPOINTS
// =========================================================================

// A. Register with Email & Password (Powered by Firebase Identity Toolkit API)
app.post('/api/auth/register-email', async (req, res) => {
    try {
        const { email, password, username, displayName } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const fbUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`;
        const fbResponse = await axios.post(fbUrl, {
            email,
            password,
            returnSecureToken: true
        });

        const { localId: userId, idToken, refreshToken, expiresIn } = fbResponse.data;
        const finalUsername = username || email.split('@')[0];

        // Store user profile in MongoDB
        const userProfile = await UserProfile.findOneAndUpdate(
            { userId },
            { 
                userId,
                username: finalUsername,
                displayName: displayName || finalUsername,
                email
            },
            { upsert: true, new: true }
        );

        res.status(201).json({
            success: true,
            message: 'User registered successfully via Firebase.',
            userId,
            token: idToken,
            refreshToken,
            expiresIn,
            user: userProfile
        });
    } catch (err) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        console.error('[AUTH REGISTER ERROR]', errorMsg);
        res.status(400).json({ error: errorMsg });
    }
});

// B. Login with Email & Password
app.post('/api/auth/login-email', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const fbUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`;
        const fbResponse = await axios.post(fbUrl, {
            email,
            password,
            returnSecureToken: true
        });

        const { localId: userId, idToken, refreshToken, expiresIn } = fbResponse.data;

        // Retrieve user profile from MongoDB
        let userProfile = await UserProfile.findOne({ userId });
        if (!userProfile) {
            userProfile = await UserProfile.create({
                userId,
                username: email.split('@')[0],
                displayName: email.split('@')[0],
                email
            });
        }

        res.json({
            success: true,
            message: 'User logged in successfully via Firebase.',
            userId,
            token: idToken,
            refreshToken,
            expiresIn,
            user: userProfile
        });
    } catch (err) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        console.error('[AUTH LOGIN ERROR]', errorMsg);
        res.status(400).json({ error: errorMsg });
    }
});

// C. Verify Firebase OAuth Token (Google, Apple, Facebook)
app.post('/api/auth/oauth-verify', async (req, res) => {
    try {
        const { idToken, username } = req.body;
        if (!idToken) {
            return res.status(400).json({ error: 'Firebase idToken is required.' });
        }

        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const { uid: userId, email, name, picture } = decodedToken;

        const finalUsername = username || (email ? email.split('@')[0] : `user_${userId.slice(0, 6)}`);

        // Upsert MongoDB User Profile
        const userProfile = await UserProfile.findOneAndUpdate(
            { userId },
            {
                userId,
                username: finalUsername,
                displayName: name || finalUsername,
                email: email || '',
                avatar: picture || ''
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: 'OAuth verified successfully with Firebase.',
            userId,
            user: userProfile
        });
    } catch (err) {
        console.error('[OAUTH VERIFY ERROR]', err);
        res.status(401).json({ error: err.message || 'Invalid or expired Firebase token.' });
    }
});

// D. Send SMS Verification Code via Firebase Phone Auth
app.post('/api/auth/phone-send-code', async (req, res) => {
    try {
        const { phoneNumber, recaptchaToken } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ error: 'phoneNumber is required.' });
        }

        const fbUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${FIREBASE_CONFIG.apiKey}`;
        const fbResponse = await axios.post(fbUrl, {
            phoneNumber,
            recaptchaToken: recaptchaToken || 'test-token'
        });

        res.json({
            success: true,
            sessionInfo: fbResponse.data.sessionInfo
        });
    } catch (err) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        res.status(400).json({ error: errorMsg });
    }
});

// E. Verify SMS Code & Sign In
app.post('/api/auth/phone-verify-code', async (req, res) => {
    try {
        const { sessionInfo, code, phoneNumber } = req.body;
        if (!sessionInfo || !code) {
            return res.status(400).json({ error: 'sessionInfo and verification code are required.' });
        }

        const fbUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${FIREBASE_CONFIG.apiKey}`;
        const fbResponse = await axios.post(fbUrl, {
            sessionInfo,
            code,
            returnSecureToken: true
        });

        const { localId: userId, idToken, refreshToken } = fbResponse.data;

        // Upsert user in MongoDB
        const userProfile = await UserProfile.findOneAndUpdate(
            { userId },
            {
                userId,
                username: `user_${phoneNumber ? phoneNumber.slice(-4) : userId.slice(0, 5)}`,
                phone: phoneNumber || ''
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            userId,
            token: idToken,
            refreshToken,
            user: userProfile
        });
    } catch (err) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        res.status(400).json({ error: errorMsg });
    }
});


// =========================================================================
// 6. CLOUDINARY UPLOAD & POSTS MANAGEMENT
// =========================================================================

// Upload Video/Image to Cloudinary & Save to MongoDB
app.post('/api/posts/upload', upload.single('media'), async (req, res) => {
    try {
        const { userId, username, userAvatar, description } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No media file provided.' });
        }
        if (!userId || !username) {
            return res.status(400).json({ error: 'userId and username are required.' });
        }

        const isVideo = req.file.mimetype.startsWith('video');
        const resourceType = isVideo ? 'video' : 'image';

        // Direct stream upload to Cloudinary with context metadata
        const uploadStream = () => {
            return new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                        resource_type: resourceType,
                        folder: 'tiktok_posts',
                        context: `description=${encodeURIComponent(description || '')}|userId=${userId}`
                    },
                    (error, result) => {
                        if (error) return reject(error);
                        resolve(result);
                    }
                );
                stream.end(req.file.buffer);
            });
        };

        const cloudResult = await uploadStream();

        // Save post document to MongoDB
        const newPost = new Post({
            userId,
            username,
            userAvatar: userAvatar || '',
            mediaUrl: cloudResult.secure_url,
            mediaType: resourceType,
            description: description || '',
            likes: [],
            favorites: []
        });

        await newPost.save();

        res.status(201).json({
            success: true,
            message: 'Uploaded to Cloudinary and saved to MongoDB.',
            post: newPost
        });
    } catch (err) {
        console.error('[UPLOAD ERROR]', err);
        res.status(500).json({ error: err.message || 'Error processing media upload.' });
    }
});

// Get Feed Posts
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 }).lean();
        
        const postsWithCounts = await Promise.all(
            posts.map(async (post) => {
                const commentsCount = await Comment.countDocuments({ postId: post._id });
                return {
                    ...post,
                    commentsCount,
                    likesCount: post.likes.length,
                    favoritesCount: post.favorites.length
                };
            })
        );

        res.json(postsWithCounts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Like / Unlike Post
app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required.' });

        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found.' });

        const index = post.likes.indexOf(userId);
        let isLiked = false;

        if (index === -1) {
            post.likes.push(userId);
            isLiked = true;
        } else {
            post.likes.splice(index, 1);
            isLiked = false;
        }

        await post.save();
        res.json({
            success: true,
            isLiked,
            likesCount: post.likes.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Favorite / Unfavorite Post
app.post('/api/posts/:id/favorite', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required.' });

        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found.' });

        const index = post.favorites.indexOf(userId);
        let isFavorited = false;

        if (index === -1) {
            post.favorites.push(userId);
            isFavorited = true;
        } else {
            post.favorites.splice(index, 1);
            isFavorited = false;
        }

        await post.save();
        res.json({
            success: true,
            isFavorited,
            favoritesCount: post.favorites.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Comments for a Post
app.get('/api/posts/:id/comments', async (req, res) => {
    try {
        const comments = await Comment.find({ postId: req.params.id }).sort({ createdAt: 1 });
        res.json(comments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add a Comment to a Post
app.post('/api/posts/:id/comments', async (req, res) => {
    try {
        const { userId, username, userAvatar, text } = req.body;
        
        if (!userId || !username || !text) {
            return res.status(400).json({ error: 'userId, username, and text are required.' });
        }

        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found.' });

        const newComment = new Comment({
            postId: req.params.id,
            userId,
            username,
            userAvatar: userAvatar || '',
            text
        });

        await newComment.save();
        const totalComments = await Comment.countDocuments({ postId: req.params.id });

        res.status(201).json({
            success: true,
            comment: newComment,
            commentsCount: totalComments
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get User Profile & Posts
app.get('/api/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        let profile = await UserProfile.findOne({ userId });
        
        if (!profile) {
            profile = {
                userId,
                username: 'user',
                displayName: 'TikTok Creator',
                avatar: '',
                bio: 'No bio yet.',
                followers: [],
                following: []
            };
        }

        const userPosts = await Post.find({ userId }).sort({ createdAt: -1 });

        let totalLikesReceived = 0;
        userPosts.forEach(post => {
            totalLikesReceived += post.likes.length;
        });

        res.json({
            profile,
            posts: userPosts,
            stats: {
                followingCount: profile.following ? profile.following.length : 0,
                followersCount: profile.followers ? profile.followers.length : 0,
                totalLikes: totalLikesReceived,
                postsCount: userPosts.length
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Follow / Unfollow User
app.post('/api/users/:targetUserId/follow', async (req, res) => {
    try {
        const { currentUserId } = req.body;
        const { targetUserId } = req.params;

        if (!currentUserId || currentUserId === targetUserId) {
            return res.status(400).json({ error: 'Invalid user IDs.' });
        }

        const targetUser = await UserProfile.findOneAndUpdate(
            { userId: targetUserId },
            { $setOnInsert: { userId: targetUserId, username: 'user' } },
            { upsert: true, new: true }
        );

        const currentUser = await UserProfile.findOneAndUpdate(
            { userId: currentUserId },
            { $setOnInsert: { userId: currentUserId, username: 'user' } },
            { upsert: true, new: true }
        );

        const isFollowing = targetUser.followers.includes(currentUserId);

        if (isFollowing) {
            targetUser.followers = targetUser.followers.filter(id => id !== currentUserId);
            currentUser.following = currentUser.following.filter(id => id !== targetUserId);
        } else {
            targetUser.followers.push(currentUserId);
            currentUser.following.push(targetUserId);
        }

        await targetUser.save();
        await currentUser.save();

        res.json({
            success: true,
            isFollowing: !isFollowing,
            followersCount: targetUser.followers.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'Online', message: 'TikTok Clone Server API is live with Firebase, Cloudinary, and MongoDB.' });
});

// --- START SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`[SERVER] Node.js server running on port ${PORT}`);
});