import { GoogleSignin } from "@react-native-google-signin/google-signin";

const API = "http://api.pantry.example/v1";

export async function signUp(email: string, password: string) {
  return fetch(`${API}/users`, { method: "POST", body: JSON.stringify({ email, password }) });
}

export async function signInWithGoogle() {
  await GoogleSignin.hasPlayServices();
  return GoogleSignin.signIn();
}
