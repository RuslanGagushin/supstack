// Sets up release signing for the Android app (run once, after `npm run android:init`).
// Creates src-tauri/gen/android/supstack.jks + keystore.properties and teaches the Gradle build to use them.
// Keep the .jks file and its password: updates to an installed app must be signed with the same key.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const android = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "gen", "android");
const gradle = join(android, "app", "build.gradle.kts");
if (!existsSync(gradle)) { console.error("Run `npm run android:init` first."); process.exit(1); }

const props = join(android, "keystore.properties");
const jks = join(android, "supstack.jks");
if (!existsSync(props)) {
  const password = process.env.SUPSTACK_KEY_PASSWORD || randomBytes(18).toString("base64url");
  const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "keytool.exe" : "keytool") : "keytool";
  if (!existsSync(jks)) {
    execFileSync(keytool, ["-genkeypair", "-v", "-keystore", jks, "-storetype", "JKS", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
      "-alias", "supstack", "-storepass", password, "-keypass", password, "-dname", "CN=Supstack"], { stdio: "inherit" });
  }
  writeFileSync(props, `password=${password}\nkeyAlias=supstack\nstoreFile=${jks.replace(/\\/g, "/")}\n`);
  console.log(`Created ${jks}\nPassword saved in ${props} — back both up.`);
}

let g = readFileSync(gradle, "utf8");
if (!g.includes('signingConfigs.getByName("release")')) {
  if (!g.includes("import java.io.FileInputStream")) g = "import java.io.FileInputStream\n" + g;
  if (!g.includes("import java.util.Properties")) g = "import java.util.Properties\n" + g;
  g = g.replace(/\n([ \t]*)buildTypes \{/, (m, ind) => `
${ind}signingConfigs {
${ind}    create("release") {
${ind}        val keystorePropertiesFile = rootProject.file("keystore.properties")
${ind}        val keystoreProperties = Properties()
${ind}        if (keystorePropertiesFile.exists()) {
${ind}            keystoreProperties.load(FileInputStream(keystorePropertiesFile))
${ind}        }
${ind}        keyAlias = keystoreProperties["keyAlias"] as String
${ind}        keyPassword = keystoreProperties["password"] as String
${ind}        storeFile = file(keystoreProperties["storeFile"] as String)
${ind}        storePassword = keystoreProperties["password"] as String
${ind}    }
${ind}}
${ind}buildTypes {`);
  g = g.replace(/getByName\("release"\)\s*\{/, (m) => `${m}\n            signingConfig = signingConfigs.getByName("release")`);
  writeFileSync(gradle, g);
  console.log("Release signing added to app/build.gradle.kts");
} else console.log("Release signing is already set up.");
