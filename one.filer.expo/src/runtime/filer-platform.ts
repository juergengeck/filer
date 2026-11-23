import {Directory} from 'expo-file-system';
import {Platform} from 'react-native';
import type {FilerHostPlatform} from '@refinio/filer.expo/host';

/** Production platform binding: thin wrappers over expo-file-system + Platform. */
export const filerHostPlatform: FilerHostPlatform = {
    os: Platform.OS,
    childDirectoryUri(containerUri: string, name: string): string {
        return new Directory(containerUri, name).uri;
    },
    async removeDirectoryTree(uri: string): Promise<void> {
        const directory = new Directory(uri);
        if (directory.exists) directory.delete();
    }
};
