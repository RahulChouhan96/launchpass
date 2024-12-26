require('dotenv').config()
const express = require("express");
const MTProto = require('@mtproto/core');
const path = require('path');
const fs = require('fs');

// This test secret API key is a placeholder. Don't include personal details in requests with this key.
// To see your test secret API key embedded in code samples, sign in to your Stripe account.
// You can also find your test secret API key at https://dashboard.stripe.com/test/apikeys.
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);


const app = express();
app.use(express.static("public"));
const bodyParser = require("body-parser");
const YOUR_DOMAIN = "http://localhost:4242";

// Session storage setup
const sessionFilePath = path.resolve(__dirname, 'mtproto_session.json');

const storage = {
    get: async (key) => {
        if (fs.existsSync(sessionFilePath)) {
            const data = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
            return data[key];
        }
        return null;
    },
    set: async (key, value) => {
        let data = {};
        if (fs.existsSync(sessionFilePath)) {
            data = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
        }
        data[key] = value;
        fs.writeFileSync(sessionFilePath, JSON.stringify(data));
    },
    remove: async (key) => {
        if (fs.existsSync(sessionFilePath)) {
            const data = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
            delete data[key];
            fs.writeFileSync(sessionFilePath, JSON.stringify(data));
        }
    },
};

// Initialize MTProto
let api = new MTProto({
    api_id: process.env.TELEGRAM_API_ID,
    api_hash: process.env.TELEGRAM_API_HASH, // Replace with your API Hash
    storageOptions: {
        instance: storage,
    },
});

// Use the secret provided by Stripe CLI for local testing
// or your webhook endpoint's secret.
const endpointSecret = process.env.STRIPE_ENDPOINT_SECRET;


app.post("/create-checkout-session", async (req, res) => {
    const sessions = await stripe.checkout.sessions.list({
        limit: 3,
    });
    const session = await stripe.checkout.sessions.create({
        ui_mode: "embedded",
        line_items: [
            {
                // Provide the exact Price ID (for example, pr_1234) of the product you want to sell
                price: process.env.STRIPE_PRICE_ID,
                quantity: 1,
            },
        ],
        mode: "payment",
        return_url: `${YOUR_DOMAIN}/return.html?session_id=${process.env.STRIPE_CLIENT_SESSION_ID}`,
    });

    res.send({ clientSecret: session.client_secret });
});


app.get("/session-status", async (req, res) => {
    const session = await stripe.checkout.sessions.retrieve(
        req.query.session_id
    );

    res.send({
        status: session.status,
        customer_email: session.customer_details.email
    });
});


const callTelegramApi = async (method, params) => {
    try {
        const result = await api.call(method, params);
        return result;
    } catch (error) {
        console.error(`Error calling ${method}:`, error);
        throw error;
    }
};


const inviteUserToChannel = async (channelUsername, userUsername) => {
    try {
        // Step 1: Resolve the channel username to get channel_id and access_hash
        const channelResolveResult = await callTelegramApi(
            "contacts.resolveUsername",
            {
                username: channelUsername, // The channel's username
            }
        );

        const channel = channelResolveResult.chats.find(
            (chat) => chat._ === "channel"
        );
        if (!channel) {
            throw new Error(
                "No channel found for the provided channel username."
            );
        }

        const { id: channel_id, access_hash: channel_access_hash } = channel;

        // Step 2: Resolve the user's username to get their user_id
        const userResolveResult = await callTelegramApi(
            "contacts.resolveUsername",
            {
                username: userUsername, // The user's username
            }
        );

        const user = userResolveResult.users.find((user) => user._ === "user");
        if (!user) {
            throw new Error("No user found for the provided user username.");
        }

        const { id: user_id, access_hash: user_access_hash } = user;

        // Step 3: Invite the user to the channel
        const inviteResult = await callTelegramApi("channels.inviteToChannel", {
            channel: {
                _: "inputChannel",
                channel_id,
                access_hash: channel_access_hash,
            },
            users: [
                {
                    _: "inputUser",
                    user_id: user_id,
                    access_hash: user_access_hash,
                },
            ],
        });

        console.log(
            "Successfully invited the user to the channel:",
            inviteResult
        );
    } catch (error) {
        console.error("Failed to invite the user to the channel:", error);
    }
};


async function fulfillCheckout(sessionId) {
    console.log("Fulfilling Checkout Session " + sessionId);

    // Retrieve the Checkout Session from the API with line_items expanded
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["line_items"],
    });

    // Check the Checkout Session's payment_status property
    // to determine if fulfillment should be peformed
    if (checkoutSession.payment_status !== "unpaid") {
        // TODO: Perform fulfillment of the line items
        // TODO: Record/save fulfillment status for this
        // Checkout Session
        (async () => {
            try {
                const channelUsername = process.env.TELEGRAM_CHANNEL_USERNAME; // Replace with the channel username
                const userUsername = process.env.TELEGRAM_USER_USERNAME; // Replace with the user's username
                await inviteUserToChannel(channelUsername, userUsername);
            } catch (error) {
                console.error("Error:", error);
            }
        })();

    }
}

app.post(
    "/webhook",
    bodyParser.raw({ type: "application/json" }),
    async (request, response) => {
        const payload = request.body;
        const sig = request.headers["stripe-signature"];

        let event;

        try {
            event = stripe.webhooks.constructEvent(
                payload,
                sig,
                endpointSecret
            );
        } catch (err) {
            return response.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (
            event.type === "checkout.session.completed" ||
            event.type === "checkout.session.async_payment_succeeded"
        ) {
            fulfillCheckout(event.data.object.id);
        }

        response.status(200).end();
    }
);

app.listen(4242, () => console.log("Running on port 4242"));
