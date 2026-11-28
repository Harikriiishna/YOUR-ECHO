import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  type ConfirmationResult,
  EmailAuthProvider,
  GoogleAuthProvider,
  type MultiFactorError,
  type MultiFactorInfo,
  type MultiFactorResolver,
  RecaptchaVerifier,
  TotpMultiFactorGenerator,
  type TotpSecret,
  getAuth,
  getMultiFactorResolver,
  multiFactor,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export type { MultiFactorInfo, MultiFactorResolver, TotpSecret };

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

let activeRecaptchaVerifier: RecaptchaVerifier | null = null;

export function clearRecaptchaVerifier(containerElement?: HTMLElement | null): void {
  if (activeRecaptchaVerifier) {
    try {
      activeRecaptchaVerifier.clear();
    } catch {
      // Ignore DOM cleanup errors
    }
    activeRecaptchaVerifier = null;
  }
  if (containerElement) {
    containerElement.replaceChildren();
  }
}

export function formatE164Phone(dialCode: string, rawNumber: string): string {
  const trimmed = rawNumber.trim();
  if (!trimmed) {
    throw new Error('Please enter your mobile phone number.');
  }

  if (trimmed.startsWith('+')) {
    const normalized = `+${trimmed.slice(1).replace(/\D/g, '')}`;
    if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
      throw new Error('Enter a valid international phone number (7 to 15 digits after +).');
    }
    return normalized;
  }

  const dialDigits = dialCode.replace(/\D/g, '');
  let digits = trimmed.replace(/\D/g, '').replace(/^0+/, '');

  // Avoid duplicating the country code if the user entered it without a leading '+'
  if (dialDigits === '91' && digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (dialDigits === '1' && digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  const full = `+${dialDigits}${digits}`;
  if (!/^\+[1-9]\d{6,14}$/.test(full)) {
    throw new Error('Enter a valid phone number (7 to 15 digits including country code).');
  }
  return full;
}

export type GoogleSignInOutcome =
  | {
      status: 'signed_in';
      idToken: string;
      displayName: string | null;
      email: string | null;
    }
  | {
      status: 'mfa_required';
      resolver: MultiFactorResolver;
      hints: MultiFactorInfo[];
    };

export async function signInWithGooglePopup(): Promise<GoogleSignInOutcome> {
  try {
    const credential = await signInWithPopup(firebaseAuth, googleProvider);
    const idToken = await credential.user.getIdToken();
    return {
      status: 'signed_in',
      idToken,
      displayName: credential.user.displayName,
      email: credential.user.email,
    };
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';
    if (code === 'auth/multi-factor-auth-required') {
      const resolver = getMultiFactorResolver(firebaseAuth, err as MultiFactorError);
      return {
        status: 'mfa_required',
        resolver,
        hints: resolver.hints,
      };
    }
    throw err;
  }
}

export async function resolveFirebaseTotpSignIn(
  resolver: MultiFactorResolver,
  hintUid: string,
  otpCode: string
): Promise<{
  idToken: string;
  displayName: string | null;
  email: string | null;
}> {
  const cleanCode = otpCode.replace(/\D/g, '');
  if (!/^\d{6}$/.test(cleanCode)) {
    throw new Error('Enter the 6-digit code from your authenticator app.');
  }
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(hintUid, cleanCode);
  const credential = await resolver.resolveSignIn(assertion);
  const idToken = await credential.user.getIdToken();
  return {
    idToken,
    displayName: credential.user.displayName,
    email: credential.user.email,
  };
}

export async function startFirebaseTotpEnrollment(): Promise<{
  totpSecret: TotpSecret;
  secretKey: string;
  totpUri: string;
}> {
  const currentUser = firebaseAuth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in with Google or a Firebase account in this browser session first.');
  }
  if (currentUser.email && !currentUser.emailVerified) {
    throw new Error('Verify your email address before enrolling in Firebase TOTP MFA.');
  }
  const multiFactorSession = await multiFactor(currentUser).getSession();
  const totpSecret = await TotpMultiFactorGenerator.generateSecret(multiFactorSession);
  const totpUri = totpSecret.generateQrCodeUrl(
    currentUser.email || currentUser.displayName || 'ECHO Member',
    'ECHO'
  );
  return {
    totpSecret,
    secretKey: totpSecret.secretKey,
    totpUri,
  };
}

export async function finalizeFirebaseTotpEnrollment(
  totpSecret: TotpSecret,
  verificationCode: string,
  mfaDisplayName = 'Authenticator App'
): Promise<MultiFactorInfo[]> {
  const currentUser = firebaseAuth.currentUser;
  if (!currentUser) {
    throw new Error('Firebase session not found. Please sign in again.');
  }
  const cleanCode = verificationCode.replace(/\D/g, '');
  if (!/^\d{6}$/.test(cleanCode)) {
    throw new Error('Enter the 6-digit code from your authenticator app.');
  }
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, cleanCode);
  await multiFactor(currentUser).enroll(assertion, mfaDisplayName.trim() || 'Authenticator App');
  return multiFactor(currentUser).enrolledFactors;
}

export function getFirebaseEnrolledFactors(): MultiFactorInfo[] {
  const currentUser = firebaseAuth.currentUser;
  if (!currentUser) return [];
  return multiFactor(currentUser).enrolledFactors;
}

export async function reauthenticateFirebaseSession(password?: string): Promise<void> {
  const currentUser = firebaseAuth.currentUser;
  if (!currentUser) {
    throw new Error('Firebase session expired. Please sign in again.');
  }
  if (password && currentUser.email) {
    const credential = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, credential);
    return;
  }
  await reauthenticateWithPopup(currentUser, googleProvider);
}

export async function unenrollFirebaseTotpFactor(
  enrollmentUid: string,
  reauthPassword?: string
): Promise<MultiFactorInfo[]> {
  const currentUser = firebaseAuth.currentUser;
  if (!currentUser) {
    throw new Error('Firebase session not found. Please sign in again.');
  }
  try {
    await multiFactor(currentUser).unenroll(enrollmentUid);
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';
    if (code === 'auth/user-token-expired' || code === 'auth/requires-recent-login') {
      await reauthenticateFirebaseSession(reauthPassword);
      await multiFactor(currentUser).unenroll(enrollmentUid);
    } else {
      throw err;
    }
  }
  return multiFactor(currentUser).enrolledFactors;
}

export async function requestFirebaseEmailVerification(): Promise<void> {
  const currentUser = firebaseAuth.currentUser;
  if (!currentUser) {
    throw new Error('No active Firebase user session.');
  }
  await sendEmailVerification(currentUser);
}

export async function sendPhoneOtp(
  phoneNumberE164: string,
  containerElement: HTMLElement
): Promise<ConfirmationResult> {
  clearRecaptchaVerifier(containerElement);

  const mountNode = document.createElement('div');
  containerElement.appendChild(mountNode);

  const verifier = new RecaptchaVerifier(firebaseAuth, mountNode, {
    size: 'invisible',
  });
  activeRecaptchaVerifier = verifier;

  try {
    await verifier.render();
    return await signInWithPhoneNumber(firebaseAuth, phoneNumberE164, verifier);
  } catch (err) {
    clearRecaptchaVerifier(containerElement);
    throw err;
  }
}

export async function verifyPhoneOtp(
  confirmationResult: ConfirmationResult,
  otpCode: string
): Promise<{
  idToken: string;
  phoneNumber: string | null;
}> {
  const cleanCode = otpCode.replace(/\D/g, '');
  if (!/^\d{6}$/.test(cleanCode)) {
    throw new Error('Enter the 6-digit OTP verification code.');
  }
  const credential = await confirmationResult.confirm(cleanCode);
  const idToken = await credential.user.getIdToken();
  return {
    idToken,
    phoneNumber: credential.user.phoneNumber,
  };
}

export async function signOutFirebase(): Promise<void> {
  clearRecaptchaVerifier();
  await signOut(firebaseAuth);
}

export function mapFirebaseAuthError(err: unknown, context: 'google' | 'phone' | 'mfa' = 'phone'): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed before finishing. Please try again.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups for this site and try again.';
    case 'auth/cancelled-popup-request':
      return 'Another sign-in window is already open. Please finish or close it and try again.';
    case 'auth/web-storage-unsupported':
      return 'Browser storage or third-party cookies are blocked in this view. Open the preview in a new browser tab to sign in.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method.';
    case 'auth/multi-factor-auth-required':
      return 'Two-factor verification is required. Enter the 6-digit code from your authenticator app.';
    case 'auth/unverified-email':
      return 'Email verification is required before enrolling in Firebase TOTP MFA.';
    case 'auth/user-token-expired':
    case 'auth/requires-recent-login':
      return 'Please re-authenticate to update your multi-factor authentication settings.';
    case 'auth/maximum-second-factor-count-exceeded':
      return 'Maximum number of enrolled second factors has been reached.';
    case 'auth/unsupported-first-factor':
      return 'Multi-factor authentication is only supported for accounts signed in with email or Google.';
    case 'auth/missing-multi-factor-session':
      return 'Your MFA setup session expired. Generate a fresh TOTP secret and try again.';
    case 'auth/operation-not-allowed':
      if (context === 'mfa') {
        return `Firebase Identity Platform TOTP MFA is not enabled on project ${firebaseConfig.projectId}. Enable TOTP MFA in Firebase Console (Identity Platform), or use ECHO Built-in Authenticator MFA above which works immediately.`;
      }
      if (context === 'google') {
        return `Google Sign-In is disabled in Firebase Console for project ${firebaseConfig.projectId}. Enable Google under Authentication → Sign-in method.`;
      }
      return `Phone SMS OTP is not enabled yet on Firebase project ${firebaseConfig.projectId}. Enable Phone under Firebase Console → Authentication → Sign-in method, or use Phone.Email / In-App OTP.`;
    case 'auth/unauthorized-domain':
      return `This domain (${window.location.hostname}) is not in Firebase Authorized Domains. Add it under Firebase Console → Authentication → Settings → Authorized domains.`;
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return 'Please enter a valid mobile number with your country code.';
    case 'auth/invalid-verification-code':
      return 'The 6-digit code is incorrect or expired. Check your authenticator app and try again.';
    case 'auth/code-expired':
      return 'This code has expired. Please use the latest 6-digit code.';
    case 'auth/too-many-requests':
      return 'Too many verification attempts. Please wait a few minutes and try again.';
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential':
      return 'Verification check could not complete. Ensure Auth is enabled and this domain is authorized in Firebase Console.';
    case 'auth/quota-exceeded':
      return 'Verification quota exceeded for this Firebase project. Try again later.';
    case 'auth/network-request-failed':
      return 'Network request failed while contacting authentication servers. Check your connection and try again.';
    case 'auth/internal-error':
      return context === 'google'
        ? 'Google sign-in could not complete in this embedded view. Try allowing popups or opening the app directly in Chrome.'
        : 'Authentication service encountered an error. Please retry in a moment.';
    default:
      return err instanceof Error ? err.message : 'Authentication failed.';
  }
}
