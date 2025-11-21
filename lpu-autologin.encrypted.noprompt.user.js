// ==UserScript==
// @name         LPU AutoLogin — Encrypted (No Prompt)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Encrypted auto-login with ZERO passphrase prompts. AES encryption with stored key.
// @match        https://internet.lpu.in/*
// @match        http://internet.lpu.in/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(async function () {
  'use strict';

  const KEY_DATA = "lpu_enc_data_v3";
  const KEY_ENCKEY = "lpu_masterKey_v3";
  const KEY_AUTO = "lpu_auto_v3";

  // -------------------------
  // Crypto helpers (AES-GCM)
  // -------------------------
  function bufToB64(buf){
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  function b64ToBuf(b64){
    return Uint8Array.from(atob(b64), c=>c.charCodeAt(0)).buffer;
  }

  async function generateKey() {
    return crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt","decrypt"]
    );
  }

  async function exportKey(key){
    const raw = await crypto.subtle.exportKey("raw", key);
    return bufToB64(raw);
  }

  async function importKey(b64){
    return crypto.subtle.importKey(
      "raw",
      b64ToBuf(b64),
      "AES-GCM",
      true,
      ["encrypt","decrypt"]
    );
  }

  async function encryptObject(obj, key){
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt(
      { name:"AES-GCM", iv },
      key,
      enc.encode(JSON.stringify(obj))
    );
    return {
      iv: bufToB64(iv),
      cipher: bufToB64(cipher)
    };
  }

  async function decryptObject(encObj, key){
    const iv = b64ToBuf(encObj.iv);
    const cipher = b64ToBuf(encObj.cipher);
    const plain = await crypto.subtle.decrypt(
      { name:"AES-GCM", iv:new Uint8Array(iv) },
      key,
      cipher
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // -------------------------
  // Load or create encryption key
  // -------------------------
  async function getMasterKey() {
    let keyB64 = await GM.getValue(KEY_ENCKEY, null);
    if (!keyB64) {
      // first time— generate key
      const key = await generateKey();
      keyB64 = await exportKey(key);
      await GM.setValue(KEY_ENCKEY, keyB64);
      return key;
    }
    return await importKey(keyB64);
  }

  // -------------------------
  // Menu Commands
  // -------------------------
  GM_registerMenuCommand("Set UID & Password", async () => {
    const uid = prompt("Enter LPU UID:", "") || "";
    const pwd = prompt("Enter LPU Password:", "") || "";
    if (!uid || !pwd) return alert("Both required.");

    const key = await getMasterKey();
    const enc = await encryptObject({ uid:uid.trim(), pwd }, key);
    await GM.setValue(KEY_DATA, enc);

    alert("Encrypted credentials saved.");
  });

  GM_registerMenuCommand("Toggle AutoLogin", async () => {
    const cur = await GM.getValue(KEY_AUTO, true);
    await GM.setValue(KEY_AUTO, !cur);
    alert("AutoLogin: " + (!cur ? "ENABLED" : "DISABLED"));
  });

  GM_registerMenuCommand("Clear Credentials", async () => {
    if (!confirm("Delete saved encrypted data?")) return;
    await GM.deleteValue(KEY_DATA);
    alert("Deleted.");
  });

  // -------------------------
  // Auto login
  // -------------------------
  async function autoLogin() {
    const auto = await GM.getValue(KEY_AUTO, true);
    if (!auto) return;

    const enc = await GM.getValue(KEY_DATA, null);
    if (!enc) return console.log("No saved creds");

    const key = await getMasterKey();
    let creds;
    try { creds = await decryptObject(enc, key); }
    catch(e){ return console.error("Decrypt fail", e); }

    // Wait for portal
    await new Promise(r=>setTimeout(r,600));

    const userField = document.querySelector("#username, #user, input[name='username'], input[type='text']");
    const passField = document.querySelector("#password, #pwd, input[type='password']");

    if (userField){ userField.value = creds.uid; userField.dispatchEvent(new Event("input",{bubbles:true})); }
    if (passField){ passField.value = creds.pwd; passField.dispatchEvent(new Event("input",{bubbles:true})); }

    const chk = document.querySelector("input[type='checkbox']");
    if (chk) chk.checked = true;

    const btn = Array.from(document.querySelectorAll("button, input[type='submit'], a"))
      .find(el => (el.innerText || el.value || "").toLowerCase().includes("login"));
    if (btn){
      try{ btn.disabled=false; }catch(e){}
      btn.click();
    }

    // Internal fallback
    try{ if(typeof window.login==="function") window.login(); }catch(e){}
    try{ if(typeof window.doLogin==="function") window.doLogin(); }catch(e){}
  }

  setTimeout(autoLogin, 500);

})();
