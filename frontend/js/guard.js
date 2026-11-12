
(async function protectPage() {
    try {
        const response = await fetch("/api/auth/me", {
            method: "GET",
            credentials: "same-origin"
        });

        if (!response.ok) {
            window.location.replace("/auth.html");
            return;
        }

    } catch (error) {
        console.error("Authentication check failed:", error);
        window.location.replace("/auth.html");
    }
})();
