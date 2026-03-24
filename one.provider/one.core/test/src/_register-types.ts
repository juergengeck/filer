import {addRecipeToRuntime, hasRecipe} from '../../lib/object-recipes.js';
import type {
    BLOB,
    CLOB,
    OneObjectTypes,
    OneUnversionedObjectTypes,
    OneVersionedObjectTypes,
    Person,
    Recipe,
    RecipeRule,
    VersionNode
} from '../../lib/recipes.js';
import type {AnyObject} from '../../lib/util/object.js';
import type {SHA256Hash, SHA256IdHash} from '../../lib/util/type-checks.js';
import type {HexString} from '../../lib/util/arraybuffer-to-and-from-hex-string.js';
import {HexStringRegex} from '../../lib/util/arraybuffer-to-and-from-hex-string.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        OneTest$KeyValueMap: OneTest$KeyValueMap;
        OneTest$NestedReferenceTest: OneTest$NestedReferenceTest;
        OneTest$UnversionedReferenceListTest: OneTest$UnversionedReferenceListTest;
        OneTest$UnversionedReferenceTest: OneTest$UnversionedReferenceTest;
        OneTest$TypeTest: OneTest$TypeTest;
        OneTest$MandatoryCollectionsTest: OneTest$MandatoryCollectionsTest;
        OneTest$OptionalCollectionsTest: OneTest$OptionalCollectionsTest;
        OneTest$ReferenceTest: OneTest$ReferenceTest;
        OneTest$Matryoschka: OneTest$Matryoschka;
        OneTest$TestUnversioned: OneTest$TestUnversioned;
        OneTest$ClobAttachment: OneTest$ClobAttachment;
        OneTest$BlobAttachment: OneTest$BlobAttachment;
        OneTest$ImploderRecipe: OneTest$ImploderRecipe;
        OneTest$Inherit1Recipe: OneTest$Inherit1Recipe;
        OneTest$Inherit2Recipe: OneTest$Inherit2Recipe;
        OneTest$WbcObservation: OneTest$WbcObservation;
        OneTest$ChannelEntry: OneTest$ChannelEntry;
        OneTest$CreationTime: OneTest$CreationTime;
        OneTest$Signature: OneTest$Signature;
        OneTest$License: OneTest$License;
    }

    export interface OneIdObjectInterfaces {
        OneTest$Email: Pick<OneTest$Email, '$type$' | 'messageID'>;
        OneTest$ImapAccount: Pick<OneTest$ImapAccount, '$type$' | 'host' | 'user'>;
        OneTest$Mailbox: Pick<OneTest$Mailbox, '$type$' | 'account' | 'name'>;
        OneTest$VersionedReferenceTest: Pick<OneTest$VersionedReferenceTest, '$type$' | 'name'>;
        OneTest$VersionedReferenceTestAllId: OneTest$VersionedReferenceTestAllId;
        OneTest$IdPropIsReference: Pick<OneTest$IdPropIsReference, '$type$' | 'id1'>;
        OneTest$TestMapId: Pick<OneTest$TestMapId, '$type$' | 'id'>;
        OneTest$TestVersioned: Pick<OneTest$TestVersioned, '$type$' | 'id'>;
        OneTest$TestVersionedOptional: Pick<
            OneTest$TestVersionedOptional,
            '$type$' | 'id1' | 'id2'
        >;
        OneTest$IdPropNestedNames: Pick<
            OneTest$IdPropNestedNames,
            '$type$' | 'propertyName' | 'thirdIdProp'
        >;
        OneTest$VersionedReferenceListTest: Pick<
            OneTest$VersionedReferenceListTest,
            '$type$' | 'identifier'
        >;
        OneTest$ChannelInfo: Pick<OneTest$ChannelInfo, 'id' | 'owner' | '$type$'>;
    }

    export interface OneVersionedObjectInterfaces {
        OneTest$Email: OneTest$Email;
        OneTest$ImapAccount: OneTest$ImapAccount;
        OneTest$Mailbox: OneTest$Mailbox;
        OneTest$VersionedReferenceTest: OneTest$VersionedReferenceTest;
        OneTest$VersionedReferenceTestAllId: OneTest$VersionedReferenceTestAllId;
        OneTest$IdPropIsReference: OneTest$IdPropIsReference;
        OneTest$TestMapId: OneTest$TestMapId;
        OneTest$TestVersioned: OneTest$TestVersioned;
        OneTest$TestVersionedOptional: OneTest$TestVersionedOptional;
        OneTest$IdPropNestedNames: OneTest$IdPropNestedNames;
        OneTest$VersionedReferenceListTest: OneTest$VersionedReferenceListTest;
        OneTest$ChannelInfo: OneTest$ChannelInfo;
    }

    export interface OneCertificateInterfaces {
        OneTest$AffirmationCertificate: OneTest$AffirmationCertificate;
    }

    export interface OneLicenseInterfaces {
        OneTest$Affirmation: OneTest$AffirmationCertificate;
    }
}

export interface OneTest$KeyValueMap {
    $type$: 'OneTest$KeyValueMap';
    name: string;
    keyJsType?: string;
    valueJsType?: string;
    item: Array<{key: string; value: any[]}>;
}

export interface OneTest$NestedReferenceTest {
    $type$: 'OneTest$NestedReferenceTest';
    name: string;
    reference?: SHA256Hash[];
    preorderedReferenceItem?: Array<{
        name: string;
        nestedReference1: SHA256Hash[];
    }>;
    unorderedReferenceItem?: Array<{
        name: string;
        nestedReference2: SHA256Hash[];
    }>;
}

export interface OneTest$UnversionedReferenceListTest {
    $type$: 'OneTest$UnversionedReferenceListTest';
    reference: Array<SHA256Hash<OneTest$UnversionedReferenceListTest>>;
}

export interface OneTest$UnversionedReferenceTest {
    $type$: 'OneTest$UnversionedReferenceTest';
    ref: SHA256Hash;
}

export interface OneTest$VersionedReferenceListTest {
    $type$: 'OneTest$VersionedReferenceListTest';
    identifier: string;
    name: string;
    reference: Array<SHA256IdHash<OneTest$VersionedReferenceListTest>>;
}

export interface OneTest$TypeTest {
    $type$: 'OneTest$TypeTest';
    string?: string[];
    boolean?: boolean[];
    number?: number[];
    integer?: number[];
    object?: AnyObject | string | number | boolean;
    map?: Array<Map<any, any>>;
    set?: Array<Set<any>>;
}

export interface OneTest$MandatoryCollectionsTest {
    $type$: 'OneTest$MandatoryCollectionsTest';
    array: string[];
    bag: string[];
    map: Map<string, string>;
    set: Set<string>;
    stringifiable: AnyObject | string | number | boolean;
}

export interface OneTest$OptionalCollectionsTest {
    $type$: 'OneTest$OptionalCollectionsTest';
    array?: string[];
    bag?: string[];
    map?: Map<string, string>;
    set?: Set<string>;
    stringifiable?: AnyObject | string | number | boolean;
}

export interface OneTest$Email {
    $type$: 'OneTest$Email';
    messageID: string;
    subject?: string;
    from?: Array<SHA256IdHash<Person>>;
    to?: Array<SHA256IdHash<Person>>;
    cc?: Array<SHA256IdHash<Person>>;
    date?: number;
    html?: SHA256Hash<CLOB>;
    text?: SHA256Hash<BLOB>;
    rawEmail?: SHA256Hash<BLOB>;
    attachment?: Array<SHA256Hash<BLOB>>;
}

export interface OneTest$ImapAccount extends AnyObject {
    $type$: 'OneTest$ImapAccount';
    host: string;
    user: string;
    email?: string;
}

export interface OneTest$Mailbox extends AnyObject {
    $type$: 'OneTest$Mailbox';
    account: string;
    name: string;
}

export interface OneTest$ReferenceTest {
    $type$: 'OneTest$ReferenceTest';
    versionedRef?: Array<SHA256Hash<OneVersionedObjectTypes>>;
    unversionedRef?: Array<SHA256Hash<OneUnversionedObjectTypes>>;
    idRef?: SHA256IdHash[];
    clob?: Array<SHA256Hash<CLOB>>;
    blob?: Array<SHA256Hash<BLOB>>;
    mapRef?: Map<SHA256IdHash<OneVersionedObjectTypes>, SHA256Hash<OneObjectTypes>>;
}

export interface OneTest$VersionedReferenceTest {
    $type$: 'OneTest$VersionedReferenceTest';
    name: string;
    versionedRef?: Array<SHA256Hash<OneVersionedObjectTypes>>;
    unversionedRef?: Array<SHA256Hash<OneUnversionedObjectTypes>>;
    idRef?: SHA256IdHash[];
    clob?: Array<SHA256Hash<CLOB>>;
    blob?: Array<SHA256Hash<BLOB>>;
}

export interface OneTest$VersionedReferenceTestAllId {
    $type$: 'OneTest$VersionedReferenceTestAllId';
    name: string;
    versionedRef?: Array<SHA256Hash<OneVersionedObjectTypes>>;
    unversionedRef?: Array<SHA256Hash<OneUnversionedObjectTypes>>;
    idRef?: SHA256IdHash[];
    clob?: Array<SHA256Hash<CLOB>>;
    blob?: Array<SHA256Hash<BLOB>>;
}

export interface OneTest$Matryoschka {
    $type$: 'OneTest$Matryoschka';
    name?: string;
    child?: Array<SHA256Hash<OneTest$Matryoschka> | OneTest$Matryoschka>;
}

export interface OneTest$IdPropIsReference {
    $type$: 'OneTest$IdPropIsReference';
    id1: Array<SHA256IdHash<any> | {$type$: 'Person'; email: string}>;
    /*
    id2: Array<{inner: SHA256Hash | {$type$: 'Person', email: string}}>;
     */
    data: string[];
}

export interface OneTest$TestMapId {
    $type$: 'OneTest$TestMapId';
    id: Map<string, string>;
    data: string[];
}

export interface OneTest$TestVersioned {
    $type$: 'OneTest$TestVersioned';
    id?: string[];
    data: string[];
}

export interface OneTest$TestVersionedOptional {
    $type$: 'OneTest$TestVersionedOptional';
    id1?: string;
    id2?: string;
}

export interface OneTest$TestUnversioned {
    $type$: 'OneTest$TestUnversioned';
    data: string[];
    [key: string]: any;
}

export interface OneTest$ClobAttachment {
    $type$: 'OneTest$ClobAttachment';
    dataType: string;
    data: SHA256Hash<CLOB>;
}

export interface OneTest$BlobAttachment {
    $type$: 'OneTest$BlobAttachment';
    dataType: string;
    data: SHA256Hash<BLOB>;
}

export interface OneTest$IdPropNestedNames {
    $type$: 'OneTest$IdPropNestedNames';
    propertyName: string[];
    otherName: string;
    nested: Array<{
        nestedItem?: string;
        propertyName: string;
    }>;
    thirdIdProp: string[];
}

export interface OneTest$ImploderRecipe {
    $type$: 'OneTest$ImploderRecipe';
    prop1: string;
    nestedObject?: Array<{
        nestedProp1?: string;
        nestedReference?: SHA256Hash<any>;
    }>;
}

export interface OneTest$Inherit1Recipe {
    $type$: 'OneTest$Inherit1Recipe';
    namedRuleProp1: {
        namedRuleItem1: string;
    };
    inheritRuleProp1: {
        override1: {
            namedRuleItem1: string;
        };
    };
    inheritRuleProp2: {
        override2: {
            namedRuleItem2: string;
        };
    };
}

export interface OneTest$Inherit2Recipe {
    $type$: 'OneTest$Inherit2Recipe';
    namedRuleProp2: {
        namedRuleItem2: string;
    };
    inheritRuleProp1: {
        override1: {
            namedRuleItem1: string;
        };
    };
    inheritRuleProp2: {
        override2: {
            namedRuleItem2: string;
        };
    };
}

export interface OneTest$WbcMeasurement {
    value: string;
    unit: string;
    unsafe?: boolean;
}

export interface OneTest$CreationTime {
    $type$: 'OneTest$CreationTime';
    timestamp: number;
    data: SHA256Hash<OneUnversionedObjectTypes>;
}

export interface OneTest$ChannelEntry {
    $type$: 'OneTest$ChannelEntry';
    data: SHA256Hash<OneTest$CreationTime>;
    metadata?: SHA256Hash[];
    previous?: SHA256Hash<OneTest$ChannelEntry>;
}

export interface OneTest$ChannelInfo {
    $type$: 'OneTest$ChannelInfo';
    id: string;
    owner?: SHA256IdHash<Person>;
    head?: SHA256Hash<OneTest$ChannelEntry>;
}

export interface OneTest$WbcObservation {
    $type$: 'OneTest$WbcObservation';
    acquisitionTime: string; // time the measurement took place e.g. '2020-09-04T12:10:01+01:00';
    Leukocytes: OneTest$WbcMeasurement;
    Neutrophils?: OneTest$WbcMeasurement;
    Lymphocytes?: OneTest$WbcMeasurement;
    Monocytes?: OneTest$WbcMeasurement;
    Eosinophils?: OneTest$WbcMeasurement;
    Basophils?: OneTest$WbcMeasurement;
}

/**
 * TS interface for SignatureRecipe.
 */
export interface OneTest$Signature {
    $type$: 'OneTest$Signature';
    issuer: SHA256IdHash<Person>;
    data: SHA256Hash;
    signature: HexString;
}

export interface OneTest$License {
    $type$: 'OneTest$License';
    name: string;
    description: string;
}

export interface OneTest$AffirmationCertificate {
    $type$: 'OneTest$AffirmationCertificate';
    data: SHA256Hash;
    license: SHA256Hash<OneTest$License>;
}

const SharedNamedRuleRef1: RecipeRule = {
    itemprop: 'inheritRuleProp1',
    itemtype: {
        type: 'object',
        rules: [
            {
                itemprop: 'override1',
                inheritFrom: 'OneTest$Inherit1Recipe.namedRuleProp1'
            }
        ]
    }
};

const SharedNamedRuleRef2: RecipeRule = {
    itemprop: 'inheritRuleProp2',
    itemtype: {
        type: 'object',
        rules: [
            {
                itemprop: 'override2',
                inheritFrom: 'OneTest$Inherit2Recipe.namedRuleProp2'
            }
        ]
    }
};

const OneTest$WbcMeasurementRules: RecipeRule[] = [
    {
        itemprop: 'value',
        itemtype: {type: 'string'}
    },
    {
        itemprop: 'unit',
        itemtype: {type: 'string'}
    },
    {
        itemprop: 'unsafe',
        itemtype: {type: 'boolean'},
        optional: true
    }
];

export const RECIPES: Recipe[] = [
    {
        $type$: 'Recipe',
        name: 'OneTest$KeyValueMap',
        rule: [
            {
                itemprop: 'name'
            },
            {
                itemprop: 'keyJsType',
                optional: true
            },
            {
                itemprop: 'valueJsType',
                optional: true
            },
            {
                itemprop: 'item',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'object',
                        rules: [
                            {
                                itemprop: 'key'
                            },
                            {
                                itemprop: 'value',
                                itemtype: {
                                    type: 'array',
                                    item: {type: 'string'}
                                }
                            }
                        ]
                    }
                }
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$NestedReferenceTest',
        rule: [
            // Test having the same itemprop "name" in different nesting levels
            {
                itemprop: 'name'
            },
            {
                itemprop: 'reference',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true
            },
            {
                itemprop: 'preorderedReferenceItem',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'object',
                        rules: [
                            // Tests having the same itemprop name more than once in a nested object,
                            // which is allowed if it is on different levels of the object
                            {
                                itemprop: 'name'
                            },
                            {
                                itemprop: 'nestedReference1',
                                itemtype: {
                                    type: 'bag',
                                    item: {
                                        type: 'referenceToObj',
                                        allowedTypes: new Set(['*'])
                                    }
                                }
                            }
                        ]
                    }
                },
                optional: true
            },
            {
                itemprop: 'unorderedReferenceItem',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'object',
                        rules: [
                            {
                                itemprop: 'name'
                            },
                            {
                                itemprop: 'nestedReference2',
                                itemtype: {
                                    type: 'bag',
                                    item: {
                                        type: 'referenceToObj',
                                        allowedTypes: new Set(['*'])
                                    }
                                }
                            }
                        ]
                    }
                },
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$UnversionedReferenceTest',
        rule: [
            {
                itemprop: 'ref',
                itemtype: {
                    type: 'referenceToObj',
                    allowedTypes: new Set(['*'])
                }
            },
            {
                itemprop: 'str',
                itemtype: {type: 'string'},
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$UnversionedReferenceListTest',
        rule: [
            {
                itemprop: 'reference',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['OneTest$UnversionedReferenceListTest'])
                    }
                }
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$VersionedReferenceListTest',
        rule: [
            {
                itemprop: 'identifier',
                itemtype: {type: 'string'},
                isId: true
            },
            {
                itemprop: 'name',
                itemtype: {type: 'string'}
            },
            {
                itemprop: 'reference',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['OneTest$VersionedReferenceListTest'])
                    }
                }
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$TypeTest',
        rule: [
            {
                itemprop: 'string',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'string',
                        regexp: /^[\w"'\s]*$/
                    }
                },
                optional: true
            },
            {
                itemprop: 'boolean',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'boolean'
                    }
                },
                optional: true
            },
            {
                itemprop: 'number',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'number'
                    }
                },
                optional: true
            },
            {
                itemprop: 'integer',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'integer'
                    }
                },
                optional: true
            },
            {
                itemprop: 'object',
                itemtype: {type: 'stringifiable'},
                optional: true
                // Setting "list" is not possible or useful - think about it, you've
                // got the array in JSON format as a result anyway...
            },
            {
                itemprop: 'map',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'map',
                        key: {type: 'string'},
                        value: {type: 'string'}
                    }
                },
                optional: true
            },
            {
                itemprop: 'set',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'set',
                        item: {type: 'stringifiable'}
                    }
                },
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$MandatoryCollectionsTest',
        rule: [
            {
                itemprop: 'array',
                itemtype: {
                    type: 'array',
                    item: {type: 'string'}
                }
            },
            {
                itemprop: 'bag',
                itemtype: {
                    type: 'bag',
                    item: {type: 'string'}
                }
            },
            {
                itemprop: 'map',
                itemtype: {
                    type: 'map',
                    key: {type: 'string'},
                    value: {type: 'string'}
                }
            },
            {
                itemprop: 'set',
                itemtype: {
                    type: 'set',
                    item: {type: 'string'}
                }
            },
            {
                itemprop: 'stringifiable',
                itemtype: {type: 'stringifiable'}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$OptionalCollectionsTest',
        rule: [
            {
                itemprop: 'array',
                itemtype: {
                    type: 'array',
                    item: {type: 'string'}
                },
                optional: true
            },
            {
                itemprop: 'bag',
                itemtype: {
                    type: 'bag',
                    item: {type: 'string'}
                },
                optional: true
            },
            {
                itemprop: 'map',
                itemtype: {
                    type: 'map',
                    key: {type: 'string'},
                    value: {type: 'string'}
                },
                optional: true
            },
            {
                itemprop: 'set',
                itemtype: {
                    type: 'set',
                    item: {type: 'string'}
                },
                optional: true
            },
            {
                itemprop: 'stringifiable',
                itemtype: {type: 'stringifiable'},
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$WbcObservation',
        rule: [
            {
                itemprop: 'acquisitionTime',
                itemtype: {type: 'string'}
            },
            {
                itemprop: 'Leukocytes',
                itemtype: {type: 'object', rules: OneTest$WbcMeasurementRules}
            },
            {
                itemprop: 'Neutrophils',
                itemtype: {type: 'object', rules: OneTest$WbcMeasurementRules},
                optional: true
            },
            {
                itemprop: 'Lymphocytes',
                itemtype: {type: 'object', rules: OneTest$WbcMeasurementRules},
                optional: true
            },
            {
                itemprop: 'Monocytes',
                itemtype: {type: 'object', rules: OneTest$WbcMeasurementRules},
                optional: true
            },
            {
                itemprop: 'Eosinophils',
                itemtype: {type: 'object', rules: OneTest$WbcMeasurementRules},
                optional: true
            },
            {
                itemprop: 'Basophils',
                itemtype: {type: 'object', rules: OneTest$WbcMeasurementRules},
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$CreationTime',
        rule: [
            {
                itemprop: 'timestamp',
                itemtype: {type: 'number'}
            },
            {
                itemprop: 'data',
                itemtype: {type: 'referenceToObj', allowedTypes: new Set(['*'])}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$ChannelEntry',
        rule: [
            {
                itemprop: 'data',
                itemtype: {type: 'referenceToObj', allowedTypes: new Set(['OneTest$CreationTime'])}
            },
            {
                itemprop: 'metadata',
                itemtype: {
                    type: 'bag',
                    item: {type: 'referenceToObj', allowedTypes: new Set(['*'])}
                },
                optional: true
            },
            {
                itemprop: 'previous',
                optional: true,
                itemtype: {type: 'referenceToObj', allowedTypes: new Set(['OneTest$ChannelEntry'])}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$ChannelInfo',
        rule: [
            {
                itemprop: 'id',
                itemtype: {type: 'string'},
                isId: true
            },
            {
                itemprop: 'owner',
                itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])},
                isId: true,
                optional: true
            },
            {
                itemprop: 'head',
                optional: true,
                itemtype: {type: 'referenceToObj', allowedTypes: new Set(['OneTest$ChannelEntry'])}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$Signature',
        rule: [
            {
                itemprop: 'issuer',
                itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
            },
            {
                itemprop: 'data',
                itemtype: {type: 'referenceToObj', allowedTypes: new Set(['*'])}
            },
            {
                itemprop: 'signature',
                itemtype: {type: 'string', regexp: HexStringRegex}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$AffirmationCertificate',
        rule: [
            {
                itemprop: 'data',
                itemtype: {type: 'referenceToObj', allowedTypes: new Set(['*'])}
            },
            {
                itemprop: 'license',
                itemtype: {type: 'referenceToObj', allowedTypes: new Set(['OneTest$License'])}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$License',
        rule: [
            {
                itemprop: 'name',
                itemtype: {type: 'string'}
            },
            {
                itemprop: 'description',
                itemtype: {type: 'string'}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$Email',
        rule: [
            {
                itemprop: 'messageID',
                isId: true
            },
            {
                itemprop: 'from',
                // It is indeed possible for an email to have more than one From address.
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['Person'])
                    }
                },
                optional: true
            },
            {
                itemprop: 'to',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['Person'])
                    }
                },
                optional: true
            },
            {
                itemprop: 'cc',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['Person'])
                    }
                },
                optional: true
            },
            {
                itemprop: 'date',
                itemtype: {type: 'number'},
                optional: true
            },
            {
                itemprop: 'subject',
                itemtype: {type: 'string'},
                optional: true
            },
            {
                itemprop: 'html',
                itemtype: {type: 'referenceToClob'},
                optional: true
            },
            {
                itemprop: 'text',
                itemtype: {type: 'referenceToBlob'},
                optional: true
            },
            {
                itemprop: 'attachment',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToBlob'
                    }
                },
                optional: true
            },
            {
                itemprop: 'rawEmail',
                itemtype: {type: 'referenceToBlob'},
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$ImapAccount',
        rule: [
            {
                itemprop: 'email'
            },
            {
                itemprop: 'host',
                isId: true
            },
            {
                itemprop: 'user',
                isId: true
            },
            {
                itemprop: 'password'
            },
            {
                itemprop: 'port',
                itemtype: {type: 'number'}
            },
            {
                itemprop: 'tls',
                itemtype: {type: 'boolean'},
                optional: true
            },
            {
                itemprop: 'tlsOptions',
                itemtype: {type: 'stringifiable'},
                optional: true
            },
            {
                itemprop: 'autotls',
                optional: true
            },
            {
                itemprop: 'xoauth',
                optional: true
            },
            {
                itemprop: 'xoauth2',
                optional: true
            },
            {
                itemprop: 'connTimeout',
                itemtype: {type: 'number'},
                optional: true
            },
            {
                itemprop: 'authTimeout',
                itemtype: {type: 'number'},
                optional: true
            },
            {
                itemprop: 'keepalive',
                itemtype: {type: 'stringifiable'},
                optional: true
            },
            {
                itemprop: 'delimiter',
                optional: true
            },
            {
                itemprop: 'fetchChunkSize',
                itemtype: {type: 'number'},
                optional: true
            },
            {
                itemprop: 'fetchChunkDelay',
                itemtype: {type: 'number'},
                optional: true
            },
            {
                itemprop: 'mailbox',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['OneTest$Mailbox'])
                    }
                },
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$Mailbox',
        rule: [
            {
                itemprop: 'account',
                isId: true
            },
            {
                itemprop: 'name',
                isId: true
            },
            {
                itemprop: 'uidValidity',
                itemtype: {type: 'number'}
            },
            {
                itemprop: 'uidEmailBlobMap',
                itemtype: {
                    type: 'referenceToObj',
                    allowedTypes: new Set(['OneTest$KeyValueMap'])
                },
                optional: true
            },
            {
                itemprop: 'email',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['OneTest$Email'])
                    }
                },
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$ReferenceTest',
        rule: [
            {
                itemprop: 'versionedRef',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true
            },
            {
                itemprop: 'unversionedRef',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true
            },
            {
                itemprop: 'idRef',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true
            },
            {
                itemprop: 'clob',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToClob'
                    }
                },
                optional: true
            },
            {
                itemprop: 'blob',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToBlob'
                    }
                },
                optional: true
            },
            {
                itemprop: 'mapRef',
                itemtype: {
                    type: 'map',
                    key: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['*'])
                    },
                    value: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$VersionedReferenceTest',
        rule: [
            {
                itemprop: 'name',
                isId: true
            },
            {
                itemprop: 'versionedRef',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true
            },
            {
                itemprop: 'unversionedRef',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true
            },
            {
                itemprop: 'idRef',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true
            },
            {
                itemprop: 'clob',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'referenceToClob'
                    }
                },
                optional: true
            },
            {
                itemprop: 'blob',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'referenceToBlob'
                    }
                },
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$VersionedReferenceTestAllId',
        rule: [
            {
                itemprop: 'name',
                isId: true
            },
            {
                itemprop: 'versionedRef',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true,
                isId: true
            },
            {
                itemprop: 'unversionedRef',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true,
                isId: true
            },
            {
                itemprop: 'idRef',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['*'])
                    }
                },
                optional: true,
                isId: true
            },
            {
                itemprop: 'clob',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'referenceToClob'
                    }
                },
                optional: true,
                isId: true
            },
            {
                itemprop: 'blob',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'referenceToBlob'
                    }
                },
                optional: true,
                isId: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$Matryoschka',
        rule: [
            {
                itemprop: 'name',
                optional: true
            },
            {
                itemprop: 'child',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['OneTest$Matryoschka'])
                    }
                },
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$IdPropIsReference',
        rule: [
            // To be able to test ID properties that are Reference objects - and throw in arrays
            {
                itemprop: 'id1',
                isId: true,
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['Person'])
                    }
                }
            },
            // To be able to test references hidden in nested objects
            // TODO At this point ID properties cannot be nested objects
            {
                itemprop: 'data',
                itemtype: {
                    type: 'bag',
                    item: {type: 'stringifiable'}
                }
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$TestMapId',
        rule: [
            {
                itemprop: 'id',
                isId: true,
                // To be able to test a versioned type where an ID property is a Map
                itemtype: {
                    type: 'map',
                    key: {type: 'string'},
                    value: {type: 'string'}
                }
            },
            {
                itemprop: 'data',
                itemtype: {type: 'bag', item: {type: 'stringifiable'}}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$TestVersioned',
        rule: [
            {
                itemprop: 'id',
                isId: true,
                // To be able to test a versioned type where an ID property is an array
                itemtype: {type: 'bag', item: {type: 'stringifiable'}},
                // To test optional (missing) ID props
                optional: true
            },
            {
                itemprop: 'data',
                itemtype: {type: 'bag', item: {type: 'stringifiable'}}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$TestVersionedOptional',
        rule: [
            {
                itemprop: 'id1',
                isId: true,
                optional: true
            },
            {
                itemprop: 'id2',
                isId: true,
                optional: true
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$TestUnversioned',
        rule: [
            {
                itemprop: 'data',
                itemtype: {type: 'bag', item: {type: 'stringifiable'}}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$ClobAttachment',
        rule: [
            {
                itemprop: 'dataType',
                itemtype: {type: 'string'}
            },
            {
                itemprop: 'data',
                itemtype: {type: 'referenceToClob'}
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$BlobAttachment',
        rule: [
            {
                itemprop: 'dataType',
                itemtype: {type: 'string'}
            },
            {
                itemprop: 'data',
                itemtype: {type: 'referenceToBlob'}
            }
        ]
    },
    // This especially tests the microdata-to-id-hash algorithm because there is a property with
    // the same name as an ID property (nested, to make that possible)
    {
        $type$: 'Recipe',
        name: 'OneTest$IdPropNestedNames',
        rule: [
            {
                itemprop: 'propertyName',
                itemtype: {type: 'bag', item: {type: 'stringifiable'}},
                isId: true
            },
            {
                itemprop: 'otherName',
                isId: true
            },
            {
                itemprop: 'nested',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'object',
                        rules: [
                            {
                                itemprop: 'nestedItem',
                                optional: true
                            },
                            {
                                itemprop: 'propertyName'
                            }
                        ]
                    }
                }
            },
            {
                itemprop: 'thirdIdProp',
                itemtype: {type: 'bag', item: {type: 'stringifiable'}},
                isId: true
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'OneTest$ImploderRecipe',
        rule: [
            {
                itemprop: 'prop1',
                itemtype: {type: 'string'}
            },
            {
                itemprop: 'nestedObject',
                optional: true,
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'object',
                        rules: [
                            {
                                itemprop: 'nestedProp1',
                                optional: true
                            },
                            {
                                itemprop: 'nestedReference',
                                itemtype: {
                                    type: 'referenceToObj',
                                    allowedTypes: new Set(['*'])
                                },
                                optional: true
                            }
                        ]
                    }
                }
            }
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$Inherit1Recipe',
        rule: [
            {
                itemprop: 'namedRuleProp1',
                itemtype: {
                    type: 'object',
                    rules: [
                        {
                            itemprop: 'namedRuleItem1'
                        }
                    ]
                }
            },
            SharedNamedRuleRef1,
            SharedNamedRuleRef2
        ]
    },
    {
        $type$: 'Recipe',
        name: 'OneTest$Inherit2Recipe',
        rule: [
            {
                itemprop: 'namedRuleProp2',
                itemtype: {
                    type: 'object',
                    rules: [
                        {
                            itemprop: 'namedRuleItem2'
                        }
                    ]
                }
            },
            SharedNamedRuleRef1,
            SharedNamedRuleRef2
        ]
    }
];

export const VERSIONED_OBJECTS: string[] = RECIPES.reduce((arr: string[], recipe: Recipe) => {
    // "isId" must be on the top level and cannot be inherited, so the check is this simple
    if (recipe.rule.some(rule => rule.isId === true)) {
        arr.push(recipe.name);
    }

    return arr;
}, []);

/**
 * @returns {undefined}
 */
export function addTestTypes(): void {
    RECIPES.forEach(recipe => {
        if (!hasRecipe(recipe.name)) {
            addRecipeToRuntime(recipe);
        }
    });
}
