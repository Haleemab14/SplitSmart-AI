const { Client } = require("@elastic/elasticsearch");

const url = String(process.env.ELASTICSEARCH_URL || "").trim();
const apiKey = String(process.env.ELASTICSEARCH_API_KEY || "").trim();

const elasticConfigured = Boolean(url && apiKey);
let elasticClient = null;

if (elasticConfigured) {
    elasticClient = new Client({
        node: url,
        auth: { apiKey },
        maxRetries: 1,
        requestTimeout: 8000
    });
}

async function elasticReady() {
    if (!elasticClient) return false;

    try {
        return Boolean(await elasticClient.ping());
    } catch (error) {
        console.error("Elasticsearch ping failed.");
        return false;
    }
}

module.exports = {
    elasticClient,
    elasticConfigured,
    elasticReady
};
