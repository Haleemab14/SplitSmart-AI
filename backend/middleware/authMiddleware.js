
const jwt = require("jsonwebtoken");

function authenticateUser(req, res, next) {
    const token = req.cookies.authToken;

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Please log in first."
        });
    }

    try {
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.user = {
            id: decoded.id,
            username: decoded.username
        };

        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Your session is invalid or expired."
        });
    }
}

module.exports = authenticateUser;
