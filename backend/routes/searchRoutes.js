const express = require("express");
const { searchWorkspace } = require("../services/workspaceSearch");

const router = express.Router();

router.get("/search", async (req, res) => {
    const groupId = Number(req.query.groupId);

    try {
        const outcome = await searchWorkspace({
            userId: req.user.id,
            query: req.query.q,
            groupId: Number.isInteger(groupId) ? groupId : 0
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        console.error("Workspace search error:", error);
        return res.status(500).json({
            success: false,
            message: "Could not search your records."
        });
    }
});

module.exports = router;
