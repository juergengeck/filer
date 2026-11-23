import {useCallback, useEffect, useRef, useState} from 'react';
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Pressable,
    Text,
    TextInput,
    View
} from 'react-native';
import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {Model, getModel, setGlobalModel, ModelProvider} from '../ios-ui';
import {getFilerOneStorageUri, hasNativeFilerHost} from '@refinio/filer.expo/host';
import {filerHostPlatform} from '../src/runtime/filer-platform';
import {palette} from '../src/theme';

// Glue passkey sign-in is intentionally local-only in v1: @glueone/auth.core's
// mobile login hardcodes client `https://fotos.one` with return URL
// `fotosone://glue-auth-result` (see auth.core/src/mobile/index.ts), so a filer
// client needs a generalized login (injectable clientId + return scheme) plus
// authority-side registration of `https://one.filer` first.

function LoginScreen({busy, onLogin}: {
    busy: boolean;
    onLogin: (username: string, password: string) => Promise<void>;
}) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const canLogin = username.trim().length > 0 && password.length > 0 && !busy;

    const submit = useCallback(async () => {
        if (!username.trim() || !password) return;
        setError(null);
        try {
            await onLogin(username.trim(), password);
        } catch (loginError) {
            setError(loginError instanceof Error ? loginError.message : String(loginError));
        }
    }, [onLogin, password, username]);

    return (
        <KeyboardAvoidingView style={{flex: 1, backgroundColor: palette.surface}} behavior="padding">
            <View style={{flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 20}}>
                <View style={{alignItems: 'center', gap: 10}}>
                    <Image
                        source={require('../assets/icon.png')}
                        style={{width: 96, height: 96, borderRadius: 24}}
                        resizeMode="cover"
                    />
                    <Text style={{fontSize: 32, fontWeight: '700', color: palette.text}}>ONE Filer</Text>
                    <Text style={{fontSize: 15, color: palette.textMuted, textAlign: 'center'}}>
                        Your ONE files in Apple Files. Sign in on this device, then pair it with
                        your existing instance from the Devices tab.
                    </Text>
                </View>

                <View style={{gap: 14}}>
                    <View style={{gap: 8}}>
                        <Text style={{fontSize: 13, fontWeight: '600', color: palette.textMuted}}>
                            Identity
                        </Text>
                        <TextInput
                            testID="expo-login-identity"
                            accessibilityLabel="Identity"
                            value={username}
                            onChangeText={setUsername}
                            editable={!busy}
                            autoCapitalize="none"
                            autoCorrect={false}
                            clearButtonMode="while-editing"
                            placeholder="Your username"
                            style={{
                                borderWidth: 1,
                                borderColor: palette.border,
                                borderRadius: 16,
                                paddingHorizontal: 16,
                                paddingVertical: 14,
                                fontSize: 16,
                                color: palette.text,
                                backgroundColor: palette.surfaceMuted
                            }}
                        />
                    </View>
                    <View style={{gap: 8}}>
                        <Text style={{fontSize: 13, fontWeight: '600', color: palette.textMuted}}>
                            Secret
                        </Text>
                        <TextInput
                            testID="expo-login-secret"
                            accessibilityLabel="Secret"
                            value={password}
                            onChangeText={setPassword}
                            editable={!busy}
                            secureTextEntry
                            placeholder="Local account secret"
                            style={{
                                borderWidth: 1,
                                borderColor: palette.border,
                                borderRadius: 16,
                                paddingHorizontal: 16,
                                paddingVertical: 14,
                                fontSize: 16,
                                color: palette.text,
                                backgroundColor: palette.surfaceMuted
                            }}
                        />
                    </View>
                </View>

                {error ? (
                    <View style={{
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: '#efc1b3',
                        backgroundColor: '#fff4ef',
                        padding: 14
                    }}>
                        <Text style={{color: palette.danger, fontSize: 14}}>{error}</Text>
                    </View>
                ) : null}

                <Pressable
                    testID="expo-local-login"
                    accessibilityRole="button"
                    onPress={submit}
                    disabled={!canLogin}
                    accessibilityState={{disabled: !canLogin}}
                    style={{
                        borderRadius: 16,
                        backgroundColor: palette.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 52,
                        opacity: canLogin ? 1 : 0.6
                    }}>
                    {busy ? (
                        <ActivityIndicator color="#ffffff" />
                    ) : (
                        <Text style={{color: '#ffffff', fontSize: 16, fontWeight: '700'}}>
                            Sign in locally
                        </Text>
                    )}
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}

function useAppInit() {
    const [model, setModel] = useState<Model | null>(null);
    const [initializing, setInitializing] = useState(true);
    const [authenticated, setAuthenticated] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loginBusy, setLoginBusy] = useState(false);
    const loginInFlight = useRef(false);
    const mountedRef = useRef(true);
    const modelRef = useRef<Model | null>(null);
    modelRef.current = model;

    const ensureModel = useCallback(async () => {
        const existing = modelRef.current ?? getModel();
        if (existing) return existing;
        // Resolve the App Group one-storage directory BEFORE MultiUser opens it.
        const storageDirectory = hasNativeFilerHost(filerHostPlatform)
            ? await getFilerOneStorageUri(filerHostPlatform)
            : 'filer.web.storage';
        const next = new Model({storageDirectory});
        next.onOneModelsReady(() => {
            if (mountedRef.current) setAuthenticated(true);
        });
        next.one.onLogout(() => {
            if (mountedRef.current) setAuthenticated(false);
        });
        modelRef.current = next;
        if (mountedRef.current) {
            setGlobalModel(next);
            setModel(next);
        }
        return next;
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        // Boot the runtime shell; authentication happens on the login screen.
        ensureModel()
            .catch(err => {
                if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (mountedRef.current) setInitializing(false);
            });
        return () => {
            mountedRef.current = false;
        };
    }, [ensureModel]);

    const login = useCallback(async (username: string, password: string) => {
        if (loginInFlight.current) return;
        loginInFlight.current = true;
        setLoginBusy(true);
        try {
            const activeModel = await ensureModel();
            const email = username.includes('@') ? username : `${username}@one.filer`;
            await activeModel.loginOrRegister(email, password, email);
        } finally {
            loginInFlight.current = false;
            if (mountedRef.current) setLoginBusy(false);
        }
    }, [ensureModel]);

    return {model, initializing, authenticated, error, login, loginBusy};
}

export default function RootLayout() {
    const {model, initializing, authenticated, error, login, loginBusy} = useAppInit();

    if (error) {
        return (
            <View style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: palette.surface,
                padding: 24
            }}>
                <Text style={{fontSize: 22, fontWeight: '700', color: palette.danger}}>Startup Failed</Text>
                <Text style={{marginTop: 10, color: palette.textMuted, textAlign: 'center'}}>{error}</Text>
            </View>
        );
    }

    if (initializing) {
        return (
            <View style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: palette.surface,
                gap: 16
            }}>
                <ActivityIndicator size="large" color={palette.accent} />
                <Text style={{color: palette.textMuted, fontSize: 15}}>Starting ONE Filer runtime...</Text>
            </View>
        );
    }

    if (!authenticated || !model) {
        return (
            <>
                <StatusBar style="dark" />
                <LoginScreen busy={loginBusy} onLogin={login} />
            </>
        );
    }

    return (
        <ModelProvider model={model}>
            <StatusBar style="auto" />
            <Stack screenOptions={{headerShown: false}}>
                <Stack.Screen name="(tabs)" options={{headerShown: false}} />
            </Stack>
        </ModelProvider>
    );
}
