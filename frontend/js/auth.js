// ==========================================
// SPLITSMART AI - AUTHENTICATION LOGIC
// ==========================================

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const switchButton = document.getElementById("switchButton");
const switchLabel = document.getElementById("switchLabel");
const authMessage = document.getElementById("authMessage");
const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");

let showingLogin = true;

function setView(isLogin) {
    showingLogin = isLogin;

    if (loginForm && registerForm) {
        loginForm.style.display = showingLogin ? "flex" : "none";
        registerForm.style.display = showingLogin ? "none" : "flex";
    }

    if (tabLogin && tabRegister) {
        tabLogin.classList.toggle("active", showingLogin);
        tabLogin.setAttribute("aria-selected", String(showingLogin));
        tabRegister.classList.toggle("active", !showingLogin);
        tabRegister.setAttribute("aria-selected", String(!showingLogin));
    }

    if (switchLabel && switchButton) {
        switchLabel.textContent = showingLogin
            ? "Don't have an account?"
            : "Already have an account?";

        switchButton.textContent = showingLogin
            ? "Create Account"
            : "Sign In";
    }

    if (authMessage) {
        authMessage.textContent = "";
    }
}

// Initial state
setView(true);

if (switchButton) {
    switchButton.addEventListener("click", () => {
        setView(!showingLogin);
    });
}

if (tabLogin) {
    tabLogin.addEventListener("click", () => setView(true));
}

if (tabRegister) {
    tabRegister.addEventListener("click", () => setView(false));
}

function showAuthMessage(message, isError = false) {
    if (!authMessage) return;
    authMessage.textContent = message;
    authMessage.style.color = isError ? "var(--danger, #ef4444)" : "var(--success, #10b981)";
}

// LOGIN SUBMIT
if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const usernameInput = document.getElementById("loginUsername");
        const passwordInput = document.getElementById("loginPassword");

        const username = usernameInput ? usernameInput.value.trim() : "";
        const password = passwordInput ? passwordInput.value : "";

        if (!username || !password) {
            showAuthMessage("Please enter your username and password.", true);
            return;
        }

        try {
            showAuthMessage("Signing in...");

            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || "Invalid credentials.");
            }

            showAuthMessage("Login successful! Redirecting...");
            window.location.replace("/dashboard.html");

        } catch (error) {
            showAuthMessage(error.message, true);
        }
    });
}

// REGISTER SUBMIT
if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const usernameInput = document.getElementById("registerUsername");
        const passwordInput = document.getElementById("registerPassword");
        const confirmPasswordInput = document.getElementById("confirmPassword");

        const username = usernameInput ? usernameInput.value.trim() : "";
        const password = passwordInput ? passwordInput.value : "";
        const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : "";

        if (!username || username.length < 3 || username.length > 25) {
            showAuthMessage("Username must be between 3 and 25 characters.", true);
            return;
        }

        if (password.length < 10) {
            showAuthMessage("Password must be at least 10 characters.", true);
            return;
        }

        if (password !== confirmPassword) {
            showAuthMessage("Passwords do not match.", true);
            return;
        }

        try {
            showAuthMessage("Creating your account...");

            const response = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || "Registration failed.");
            }

            showAuthMessage("Account created successfully! Redirecting...");
            window.location.replace("/dashboard.html");

        } catch (error) {
            showAuthMessage(error.message, true);
        }
    });
}
