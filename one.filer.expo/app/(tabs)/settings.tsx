import {useState} from 'react';
import {ActivityIndicator, Alert, Pressable, ScrollView, Text, View} from 'react-native';
import {FILER_FOLDER_IDS, type FilerFolderId, type FilerFolderMode} from '@refinio/filer.core';
import {useModel} from '../../ios-ui/hooks/ModelContext';
import {useFolderModes} from '../../ios-ui/hooks/useFilerStatus';
import {palette} from '../../src/theme';

const MODE_LABELS: FilerFolderMode[] = ['auto', 'visible', 'hidden'];

// Only Files projects into Apple Files in v1; Fotos and Health stay synced
// preferences for desktop and upcoming iOS projections.
const FOLDER_HINTS: Record<FilerFolderId, string> = {
    files: 'Projects into Apple Files under ONE Filer.',
    fotos: 'Synced preference for desktop; iOS gallery projection is upcoming.',
    'health.flexibel': 'Synced preference for desktop; iOS Health projection is upcoming.'
};

export default function SettingsTab() {
    const model = useModel();
    const modes = useFolderModes(model);
    const [busyFolder, setBusyFolder] = useState<FilerFolderId | null>(null);
    const [resetting, setResetting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const setMode = async (folder: FilerFolderId, mode: FilerFolderMode) => {
        setBusyFolder(folder);
        setError(null);
        try {
            await model.setFolderMode(folder, mode);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyFolder(null);
        }
    };

    const reset = () => {
        Alert.alert(
            'Reset ONE Filer?',
            'This erases local ONE storage and the File Provider catalog on this device.',
            [
                {text: 'Cancel', style: 'cancel'},
                {
                    text: 'Reset',
                    style: 'destructive',
                    onPress: () => {
                        setResetting(true);
                        void model
                            .reset()
                            .catch(err => setError(err instanceof Error ? err.message : String(err)))
                            .finally(() => setResetting(false));
                    }
                }
            ]
        );
    };

    return (
        <ScrollView
            style={{flex: 1, backgroundColor: palette.surface}}
            contentContainerStyle={{padding: 16, gap: 16}}>
            <View style={{gap: 4}}>
                <Text style={{fontSize: 13, fontWeight: '600', color: palette.textMuted}}>Account</Text>
                <Text style={{fontSize: 14, color: palette.text}}>
                    Owner {model.ownerId?.slice(0, 16) ?? '—'}
                </Text>
                <Text style={{fontSize: 14, color: palette.text}}>
                    Instance {model.instanceId?.slice(0, 16) ?? '—'}
                </Text>
            </View>

            <View style={{gap: 8}}>
                <Text style={{fontSize: 13, fontWeight: '600', color: palette.textMuted}}>
                    Filer folders
                </Text>
                <Text style={{fontSize: 13, color: palette.textMuted}}>
                    Auto follows the owning product projection; visible and hidden are explicit
                    overrides synced back over IoM.
                </Text>
                {FILER_FOLDER_IDS.map(folder => {
                    const current = modes?.[folder] ?? 'auto';
                    return (
                        <View
                            key={folder}
                            style={{
                                borderWidth: 1,
                                borderColor: palette.border,
                                borderRadius: 12,
                                padding: 12,
                                backgroundColor: palette.surfaceMuted,
                                gap: 8
                            }}>
                            <Text style={{fontSize: 15, fontWeight: '600', color: palette.text}}>
                                {folder}
                            </Text>
                            <Text style={{fontSize: 12, color: palette.textMuted}}>
                                {FOLDER_HINTS[folder]}
                                {folder === 'files' && current === 'hidden'
                                    ? ' Hidden pauses the Files projection.'
                                    : ''}
                            </Text>
                            <View style={{flexDirection: 'row', gap: 8}}>
                                {MODE_LABELS.map(mode => {
                                    const selected = current === mode;
                                    return (
                                        <Pressable
                                            key={mode}
                                            accessibilityRole="button"
                                            onPress={() => void setMode(folder, mode)}
                                            disabled={busyFolder === folder}
                                            style={{
                                                flex: 1,
                                                borderRadius: 10,
                                                paddingVertical: 10,
                                                alignItems: 'center',
                                                backgroundColor: selected
                                                    ? palette.accent
                                                    : palette.surface,
                                                borderWidth: 1,
                                                borderColor: selected ? palette.accent : palette.border
                                            }}>
                                            {busyFolder === folder ? (
                                                <ActivityIndicator
                                                    color={selected ? '#ffffff' : palette.accent}
                                                />
                                            ) : (
                                                <Text style={{
                                                    fontSize: 13,
                                                    fontWeight: '600',
                                                    color: selected ? '#ffffff' : palette.text
                                                }}>
                                                    {mode}
                                                </Text>
                                            )}
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}
            </View>

            {error ? <Text style={{fontSize: 13, color: palette.danger}}>{error}</Text> : null}

            <Pressable
                accessibilityRole="button"
                onPress={reset}
                disabled={resetting}
                style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: palette.danger,
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 52,
                    opacity: resetting ? 0.6 : 1
                }}>
                {resetting ? (
                    <ActivityIndicator color={palette.danger} />
                ) : (
                    <Text style={{color: palette.danger, fontSize: 16, fontWeight: '700'}}>
                        Reset storage
                    </Text>
                )}
            </Pressable>
        </ScrollView>
    );
}
