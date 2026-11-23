import {useState} from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    Share,
    Text,
    TextInput,
    View
} from 'react-native';
import type {Invitation} from '@refinio/one.models/lib/misc/ConnectionEstablishment/PairingManager.js';
import type {PairingIdentityRelation} from '@refinio/one.models/lib/misc/ConnectionEstablishment/PairingManager.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {useModel} from '../../ios-ui/hooks/ModelContext';
import {usePairedPeers} from '../../ios-ui/hooks/usePairedPeers';
import {
    formatInvitationUrl,
    parseInvitationInput,
    type InvitationMode
} from '../../src/runtime/invitation-codec';
import {palette} from '../../src/theme';

const MODES: Array<{mode: InvitationMode; label: string; relation: PairingIdentityRelation}> = [
    {mode: 'IoM', label: 'This person', relation: 'same-person'},
    {mode: 'IoP', label: 'Partner', relation: 'distinct-person'}
];

export default function DevicesTab() {
    const model = useModel();
    const {peers, loading, refresh} = usePairedPeers(model);
    const [mode, setMode] = useState<InvitationMode>('IoM');
    const [invitation, setInvitation] = useState<string | null>(null);
    const [invitationInput, setInvitationInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const myPersonId = () => model.ownerId as SHA256IdHash<Person> | undefined;

    const createInvitation = async () => {
        if (!model.connections) {
            setError('Connections are not ready yet.');
            return;
        }
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const relation = MODES.find(entry => entry.mode === mode)?.relation ?? 'same-person';
            const created: Invitation = await model.connections.pairing.createInvitation(
                myPersonId(),
                undefined,
                {identityRelation: relation}
            );
            setInvitation(formatInvitationUrl(created, mode));
            setNotice('Share this invitation URL with the other device, then accept it there.');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    const shareInvitation = async () => {
        if (!invitation) return;
        try {
            await Share.share({message: invitation});
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const acceptInvitation = async () => {
        if (!model.connections) {
            setError('Connections are not ready yet.');
            return;
        }
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const parsed = parseInvitationInput(invitationInput);
            await model.connections.pairing.connectUsingInvitation(parsed, myPersonId());
            setInvitationInput('');
            setNotice('Pairing started. Watch the peer list for the new device.');
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <ScrollView
            style={{flex: 1, backgroundColor: palette.surface}}
            contentContainerStyle={{padding: 16, gap: 16}}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}>
            <View style={{gap: 8}}>
                <Text style={{fontSize: 13, fontWeight: '600', color: palette.textMuted}}>
                    Paired devices
                </Text>
                {loading ? (
                    <ActivityIndicator color={palette.accent} />
                ) : peers.length === 0 ? (
                    <Text style={{fontSize: 14, color: palette.textMuted}}>
                        No paired devices yet. Create an invitation below and accept it on your other
                        device.
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

            <View style={{gap: 8}}>
                <Text style={{fontSize: 13, fontWeight: '600', color: palette.textMuted}}>
                    Pair a new device
                </Text>
                <View style={{flexDirection: 'row', gap: 8}}>
                    {MODES.map(entry => {
                        const selected = mode === entry.mode;
                        return (
                            <Pressable
                                key={entry.mode}
                                accessibilityRole="button"
                                onPress={() => setMode(entry.mode)}
                                disabled={busy}
                                style={{
                                    flex: 1,
                                    borderRadius: 10,
                                    paddingVertical: 10,
                                    alignItems: 'center',
                                    backgroundColor: selected ? palette.accent : palette.surface,
                                    borderWidth: 1,
                                    borderColor: selected ? palette.accent : palette.border
                                }}>
                                <Text style={{
                                    fontSize: 13,
                                    fontWeight: '600',
                                    color: selected ? '#ffffff' : palette.text
                                }}>
                                    {entry.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void createInvitation()}
                    disabled={busy}
                    style={{
                        borderRadius: 16,
                        backgroundColor: palette.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 52,
                        opacity: busy ? 0.6 : 1
                    }}>
                    {busy ? (
                        <ActivityIndicator color="#ffffff" />
                    ) : (
                        <Text style={{color: '#ffffff', fontSize: 16, fontWeight: '700'}}>
                            Create pairing invitation
                        </Text>
                    )}
                </Pressable>
                {invitation ? (
                    <View style={{
                        borderWidth: 1,
                        borderColor: palette.border,
                        borderRadius: 12,
                        padding: 12,
                        backgroundColor: palette.surfaceMuted,
                        gap: 8
                    }}>
                        <Text selectable style={{fontSize: 12, color: palette.text}}>{invitation}</Text>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void shareInvitation()}
                            style={{
                                borderRadius: 10,
                                borderWidth: 1,
                                borderColor: palette.accent,
                                alignItems: 'center',
                                justifyContent: 'center',
                                minHeight: 44
                            }}>
                            <Text style={{color: palette.accent, fontSize: 14, fontWeight: '700'}}>
                                Share invitation
                            </Text>
                        </Pressable>
                    </View>
                ) : null}
            </View>

            <View style={{gap: 8}}>
                <Text style={{fontSize: 13, fontWeight: '600', color: palette.textMuted}}>
                    Accept an invitation
                </Text>
                <TextInput
                    testID="devices-invitation-input"
                    accessibilityLabel="Invitation"
                    value={invitationInput}
                    onChangeText={setInvitationInput}
                    editable={!busy}
                    multiline
                    placeholder="Paste invitation URL or JSON here"
                    style={{
                        borderWidth: 1,
                        borderColor: palette.border,
                        borderRadius: 12,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        fontSize: 13,
                        minHeight: 96,
                        color: palette.text,
                        backgroundColor: palette.surfaceMuted
                    }}
                />
                <Pressable
                    testID="devices-invitation-accept"
                    accessibilityRole="button"
                    onPress={() => void acceptInvitation()}
                    disabled={busy || invitationInput.trim().length === 0}
                    style={{
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: palette.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 52,
                        opacity: busy || invitationInput.trim().length === 0 ? 0.6 : 1
                    }}>
                    <Text style={{color: palette.accent, fontSize: 16, fontWeight: '700'}}>
                        Accept invitation
                    </Text>
                </Pressable>
            </View>

            {error ? <Text style={{fontSize: 13, color: palette.danger}}>{error}</Text> : null}
            {notice ? <Text style={{fontSize: 13, color: palette.textMuted}}>{notice}</Text> : null}
        </ScrollView>
    );
}
