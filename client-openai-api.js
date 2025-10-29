// const url = "https://api.stubfx.io/";
const url = "http://localhost:3000/";

export async function chat(text) {
    try {
        const response = await fetch(url + "chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({text: text})
        });
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error(error.message);
    }
}

export async function imagine(prompt) {
    try {
        const response = await fetch(url + "imagine", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({prompt: prompt})
        });
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error(error.message);
    }
}
