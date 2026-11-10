import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthSession, describeAuthError, signIn } from '../services/AuthService';
import { colors, radius, spacing } from '../theme';

interface Props {
  onSignedIn: (session: AuthSession) => void;
}

const login = colors;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Screen 0 — sign in with Keycloak before scanning. */
export function LoginScreen({ onSignedIn }: Props) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (loading) {
      return;
    }
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length === 0) {
      setError('Enter your password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      onSignedIn(await signIn(trimmed, password));
    } catch (e) {
      setError(describeAuthError(e));
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.wordmark} accessibilityRole="header">
          WeldIQ
        </Text>

        <Text style={styles.title}>Sign in to WeldIQ</Text>
        <Text style={styles.subtitle}>Welcome back. Pick up where you left off.</Text>

        <Text style={styles.label}>EMAIL</Text>
        <TextInput
          testID="login-email"
          style={[styles.input, focused === 'email' && styles.inputFocused]}
          value={email}
          onChangeText={setEmail}
          onFocus={() => setFocused('email')}
          onBlur={() => setFocused(null)}
          placeholder="you@company.com"
          placeholderTextColor={login.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
        />

        <Text style={[styles.label, styles.labelSpaced]}>PASSWORD</Text>
        <View style={[styles.input, styles.passwordRow, focused === 'password' && styles.inputFocused]}>
          <TextInput
            testID="login-password"
            style={styles.passwordInput}
            value={password}
            onChangeText={setPassword}
            onFocus={() => setFocused('password')}
            onBlur={() => setFocused(null)}
            placeholder="Password"
            placeholderTextColor={login.muted}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            onPress={() => setShowPassword(s => !s)}
            hitSlop={8}>
            <Text style={styles.toggle}>{showPassword ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          testID="login-submit"
          accessibilityRole="button"
          accessibilityState={{ disabled: loading, busy: loading }}
          onPress={submit}
          disabled={loading}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, loading && styles.buttonBusy]}>
          {loading ? <ActivityIndicator color={login.onAccent} /> : <Text style={styles.buttonLabel}>Sign in</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: login.bg },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, maxWidth: 480, width: '100%', alignSelf: 'center' },
  wordmark: { color: login.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.3, marginBottom: 40 },
  title: { color: login.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: login.muted, fontSize: 16, marginTop: spacing.sm, marginBottom: 32 },
  label: { color: login.label, fontSize: 13, fontWeight: '700', letterSpacing: 0.8, marginBottom: spacing.sm },
  labelSpaced: { marginTop: spacing.xl },
  input: {
    minHeight: 54,
    backgroundColor: login.panel,
    borderColor: login.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    color: login.text,
    fontSize: 17,
  },
  inputFocused: { borderColor: login.borderFocus },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, minHeight: 52, color: login.text, fontSize: 17 },
  toggle: { color: login.label, fontSize: 15, fontWeight: '600', paddingLeft: spacing.md },
  error: { color: login.danger, fontSize: 14, marginTop: spacing.md },
  button: {
    minHeight: 54,
    marginTop: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: login.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { backgroundColor: login.accentPressed },
  buttonBusy: { opacity: 0.7 },
  buttonLabel: { color: login.onAccent, fontSize: 18, fontWeight: '700' },
});
