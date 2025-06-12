const fs = require("fs");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const APP_ID = "1372732"; 
const PRIVATE_KEY_PATH = "./private-key.pem";
const OWNER = "epfl-si";

function generateJWT() {
  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: APP_ID,
  };
  return jwt.sign(payload, privateKey, { algorithm: "RS256" });
}

async function getInstallationId(jwtToken) {
  const res = await axios.get("https://api.github.com/app/installations", {
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      Accept: "application/vnd.github+json",
    },
  });
  const installation = res.data[0];
  if (!installation) throw new Error("No installation found !");
  return installation.id;
}

async function getAccessToken(jwtToken, installationId) {
  try {
    
    console.log("🔐 Génération du JWT...");
    const jwtToken = generateJWT();

    console.log("📥 Récupération de l'installation ID...");
    const installationId = await getInstallationId(jwtToken);
    console.log(`✅ installation_id = ${installationId}`);

    console.log("🔑 Demande du token d'installation...");
    const res = await callGitHubAPI(`/app/installations/${installationId}/access_tokens`, 'POST', jwtToken)
    return res.data.token;

  } catch (error) {
    console.error("❌ Error :", error.response?.data || error.message);
  }
 
}



