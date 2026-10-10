import * as AppleAuthentication from "expo-apple-authentication";
import Purchases from "react-native-purchases";

const API = "https://api.pantry.example/v1";

export async function signUp(email: string, password: string) {
  return fetch(`${API}/users`, { method: "POST", body: JSON.stringify({ email, password }) });
}

export async function signInWithApple() {
  return AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL] });
}

export async function deleteAccount(token: string) {
  return fetch(`${API}/me`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

export async function restore() {
  return Purchases.restorePurchases();
}
