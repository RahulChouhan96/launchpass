require('dotenv').config()


// Join a channel
(async () => {
    try {
        const channel = process.env.TELEGRAM_CHANNEL_LINK;
        const result = await callTelegramApi("channels.joinChannel", {
            channel: channel,
        });
        console.log("Successfully joined the channel:", result);
    } catch (error) {
        console.error("Failed to join the channel:", error);
    }
})();


// Function to call Telegram API with migration handling
const callTelegramApi = async (method, params) => {
    try {
        const result = await api.call(method, params);
        return result;
    } catch (error) {
        if (error.error_message && error.error_message.startsWith('PHONE_MIGRATE')) {
            // Extract the DC number from the error message
            const newDc = parseInt(error.error_message.split('_')[2], 10);

            console.log(`Redirecting to data center: DC${newDc}`);

            // Update the MTProto instance with the new data center
            api.setDefaultDc(newDc);

            // Retry the request
            return await api.call(method, params);
        }
        throw error;
    }
};

// Authenticate the user
const authenticateUser = async () => {
    const phoneNumber = process.env.USER_CONTACT_NUMBER; // Replace with your phone number
    try {
        // Send login code
        const { phone_code_hash } = await callTelegramApi('auth.sendCode', {
            phone_number: phoneNumber,
            settings: {
                _: 'codeSettings',
            },
        });

        // Prompt user for the code received on their Telegram app
        const phoneCode = 'PHONE_CODE'; // Replace with the actual code

        // Sign in
        const signInResult = await callTelegramApi('auth.signIn', {
            phone_number: phoneNumber,
            phone_code: phoneCode,
            phone_code_hash,
        });

        console.log('Signed in successfully:', signInResult);
    } catch (error) {
        console.error('Authentication failed:', error);
    }
};

// Main function
(async () => {
    try {
        await authenticateUser();
    } catch (error) {
        console.error('Error:', error);
    }
})();
