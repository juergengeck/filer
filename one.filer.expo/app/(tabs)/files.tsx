import {useCallback, useState} from 'react';
import {ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, View} from 'react-native';
import {useModel} from '../../ios-ui/hooks/ModelContext';
import {usePairedPeers} from '../../ios-ui/hooks/usePairedPeers';
import {useFolderModes, useOnlineState} from '../../ios-ui/hooks/useFilerStatus';
import {palette} from '../../src/theme';

export default function FilesTab() {
    const model = useModel();
    const {peers, loading, refresh} = usePairedPeers(model);
    const modes = useFolderModes(model);
    const online = useOnlineState(model);
    const [openFilesError, setOpenFilesError] = useState<string | null>(null);

    const openInFiles = useCallback(async () => {
        setOpenFilesError(null);
        try {
            const url = 'shareddocuments://';
            if (await Linking.canOpenURL(url)) {
                await Linking.openURL(url);
            } else {
                setOpenFilesError('Files cannot be opened from here; open Apple Files and choose ONE Filer.');
            }
        } catch (error) {
            setOpenFilesError(error instanceof Error ? error.message : String(error));
        }
    }, []);

    return (
        <ScrollView
            style={{flex: 1, backgroundColor: palette.surface}}
            contentContainerStyle={{padding: 16, gap: 16}}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}>
            <View style={{gap: 6}}>
                <Text style={{fontSize: 15, color: palette.text}}>
                    {model.initialized ? 'Runtime ready' : 'Runtime starting...'}
                    {online ? ' · online' : ' · offline'}
                </Text>
                <Text style={{fontSize: 13, color: palette.textMuted}}>
                    Owner {model.ownerId?.slice(0, 12) ?? '—'} · Instance{' '}
                    {model.instanceId?.slice(0, 12) ?? '—'}
                </Text>
                <Text style={{fontSize: 13, color: palette.textMuted}}>
                    Shared roots from {peers.length} paired {peers.length === 1 ? 'peer' : 'peers'} project
                    into Apple Files under ONE Filer.
                </Text>
            </View>

            {modes ? (
                <View style={{gap: 4}}>
                    <Text style={{fontSize: 13, fontWeight: '600', color: palette.textMuted}}>
                        Visible folders
                    </Text>
                    {(['files', 'fotos', 'health.flexibel'] as const).map(folder => (
                        <Text key={folder} style={{fontSize: 14, color: palette.text}}>
                            {folder}: {modes[folder]}
                        </Text>
                    ))}
                </View>
            ) : null}

            <Pressable
                accessibilityRole="button"
                onPress={() => void openInFiles()}
                style={{
                    borderRadius: 16,
                    backgroundColor: palette.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 52
                }}>
                <Text style={{color: '#ffffff', fontSize: 16, fontWeight: '700'}}>Open in Files</Text>
            </Pressable>
            {openFilesError ? (
                <Text style={{fontSize: 13, color: palette.danger}}>{openFilesError}</Text>
            ) : null}

            <View style={{gap: 8}}>
                <Text style={{fontSize: 13, fontWeight: '600', color: palette.textMuted}}>
                    Paired peers
                </Text>
                {loading ? (
                    <ActivityIndicator color={palette.accent} />
                ) : peers.length === 0 ? (
                    <Text style={{fontSize: 14, color: palette.textMuted}}>
                        No paired peers yet. Pair a device to receive shared folders.
                    </Text>
                ) : (
                    peers.map(peer => (
                        <View
                            key={peer.id}
                            style={{
                                borderWidth: 1,
                                borderColor: palette.border,
                                borderRadius: 12,
                                padding: 12,
                                backgroundColor: palette.surfaceMuted
                            }}>
                            <Text style={{fontSize: 15, fontWeight: '600', color: palette.text}}>
                                {peer.name}
                            </Text>
                            <Text style={{fontSize: 12, color: palette.textMuted}}>
                                {peer.id.slice(0, 16)}… · {peer.endpoints} endpoints
                            </Text>
                        </View>
                    ))
                )}
            </View>
        </ScrollView>
    );
}
