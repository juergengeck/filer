import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {
    getObject,
    storeUnversionedObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {
    getObjectByIdObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {objectEvents} from '../../misc/ObjectEventDispatcher.js';
import {OEvent} from '../../misc/OEvent.js';
import type {Demand, MatchResponse, Supply} from '../../recipes/MatchingRecipes.js';
import type ChannelManager from '../ChannelManager.js';
import MatchingModel from './MatchingModel.js';

/**
 * This represents a MatchingEvents
 * @enum
 *       CatalogUpdate -> updates the catalog tags everytime a new supply or a demand is added
 *       SupplyUpdate -> updates the supplies
 *       DemandUpdate -> updates the demands
 *       NewMatch -> updates the matches
 */
export enum MatchingEvents {
    CatalogUpdate = 'catalogUpdate',
    SupplyUpdate = 'supplyUpdate',
    DemandUpdate = 'demandUpdate',
    MatchUpdate = 'matchUpdate'
}

// const MATCHING_CONTACT =
//     ('%3Cspan%20itemscope%20itemtype=%22http://refin.io/Contact%22%3E%3Cspan%20itemprop=%22personId%22%20data-hash=%22614061963a88891163325a4db961323e0fe48fbf5ed0db2b7eb57e4cabd8a45e%22%20data-id-hash=%229df182a1acb53dc1e04e2d9ce8bd0df2b5e338f39488a55aa801310d15595310%22%20itemscope%20itemtype=%22http://refin.io/Person%22%3E%3Cspan%20itemprop=%22email%22%3Eperson@match.one%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22communicationEndpoints%22%20data-hash=%223dba2d1fab1ea963b8f87ca75c917e1ffcb87776e98d886c845778d7f6470ab8%22%20itemscope%20itemtype=%22http://refin.io/OneInstanceEndpoint%22%3E%3Cspan%20itemprop=%22personId%22%20data-hash=%22614061963a88891163325a4db961323e0fe48fbf5ed0db2b7eb57e4cabd8a45e%22%20data-id-hash=%229df182a1acb53dc1e04e2d9ce8bd0df2b5e338f39488a55aa801310d15595310%22%20itemscope%20itemtype=%22http://refin.io/Person%22%3E%3Cspan%20itemprop=%22email%22%3Eperson@match.one%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22instanceId%22%20data-hash=%22e73fcad108e56a3bb50a89599389d88da329f63cc3f86ecc6a198b8a9f5efc16%22%20data-id-hash=%2293015f7b1dfb103e2123e659eb69e64b6f9905a3ec7f0c24e9df3f34fcdb96a6%22%20itemscope%20itemtype=%22http://refin.io/Instance%22%3E%3Cspan%20itemprop=%22name%22%3Ematching%3C/span%3E%3Cspan%20itemprop=%22owner%22%20data-hash=%22614061963a88891163325a4db961323e0fe48fbf5ed0db2b7eb57e4cabd8a45e%22%20data-id-hash=%229df182a1acb53dc1e04e2d9ce8bd0df2b5e338f39488a55aa801310d15595310%22%20itemscope%20itemtype=%22http://refin.io/Person%22%3E%3Cspan%20itemprop=%22email%22%3Eperson@match.one%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22096d0631876899e26ef5f656e3ff7d40062677744eaf75a5830e20014b7c28a2%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ENews%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Econtent%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%220f8711e456f8778f2b65019091a3b92abe04cbdefa1ded0a85d30c46bc9aab00%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ESupplyMap%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ename%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Emap%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3EMap%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22276a177ef6f81dcaa4706abbee63fe057b060fb1908f7b532bfec63d5dff1a2e%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EPersonName%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ename%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2230239a8b5f253a9b48eab68427bef89c1651eedc5b3bdfc22160082d21f8fc2b%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ESomeone%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EmainProfile%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Profile%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eprofiles%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Profile%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%223305468853faebd79159ad91751733be41e1c8cebc18072d7095d47d614363d5%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ENotifiedUsers%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ename%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EexistingMatches%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3EMap%3C/span%3E%3Cspan%20itemprop=%22optional%22%3Etrue%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%223589ba7b14eab4d131effdaa6e5932dceeebb4dc7b2fb80ce7735d045c0dc0dd%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EDemandMap%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ename%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Emap%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3EMap%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%223978fdf0c9aca6ee649cd429e4e58ba1bd67c1b1d0ce9e4ea9dd8348d1756073%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EDemand%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eidentity%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ematch%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EisActive%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Eboolean%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Etimestamp%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Enumber%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%223c7cdffca9da49e75f313e99aacf4b426165e9b70402271aa5ade27c8866f0c1%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EContactApp%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EappId%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22regexp%22%3E/%5EContactApp$/%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eme%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Someone%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Econtacts%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Someone%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2240348df733b88ba21b4d55b2d718b52c1ce00223d97b274990d0b1c1f6466174%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EDiaryEntry%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eentry%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%224a833eb32fb86e5ccd014881cc5e6c58f5e4844cabd6e0d6b5faeaaee4c3d95b%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ELocalInstancesList%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eid%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22regexp%22%3E/%5ELocalInstancesList$/%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Einstances%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByApp%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Einstance%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Instance%22%5D%3C/span%3E%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2252244d999860b12145a2d7197fe7e8d58b3172c1fa36d261f432d37b327bdf31%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EOneInstanceEndpoint%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EpersonId%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Person%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EinstanceId%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Instance%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EpersonKeys%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Keys%22%5D%3C/span%3E%3Cspan%20itemprop=%22optional%22%3Etrue%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EinstanceKeys%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Keys%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eurl%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2258295b30525135bfd235fb6aeaeb26b40e6ad435084c1773c5bf4c6281909f08%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EChannelInfo%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eid%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eowner%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Person%22%5D%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ehead%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22ChannelEntry%22%5D%3C/span%3E%3Cspan%20itemprop=%22optional%22%3Etrue%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22585627a6633a2148b94add7f8a469d0745db2d6108eca8fd0f45590037247cd2%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EContact%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EpersonId%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Person%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EcommunicationEndpoints%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22OneInstanceEndpoint%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EcontactDescriptions%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22PersonName%22,%22ProfileImage%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22714d3803031cb602dc7f3e41123761fbf3949dfd03c3a5820bd075a617093965%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EConsentFile%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EfileData%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EfileType%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22794fb7d322606efa1c0d2d27085281050d9d604d298f92406c7cce555cdb61a6%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ESupply%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eidentity%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ematch%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EisActive%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Eboolean%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Etimestamp%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Enumber%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2288b157f7f06b4e226d1ef7d2ad7c429e00418e5bd512a19798f0e2c60fa529d0%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EBodyTemperature%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Etemperature%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%228c2869d58b7ecc573b36be02ac5edc44be73768ad422818738f148b8a7187595%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EMatchResponse%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eidentity%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ematch%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EidentityOfDemand%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Eboolean%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EcreationTimestamp%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Enumber%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2290aa8c65ffd19aec93b51c49775330f3c8af1c21990a75f3e1b2cec77826a3bb%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EProfileImage%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eimage%3C/span%3E%3Cspan%20itemprop=%22referenceToBlob%22%3Etrue%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%229abb5cb80bd1d913877481da8f69447243dc977ae7550f0b7b73751d155b41a9%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EQuestionnaireResponse%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Equestionnaire%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eitem%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3ElinkId%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eanswer%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22a73834e0cc351a3d4bd4add8abb037d26ad33cfae75769924b01b017a86dfa11%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ECreationTime%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Etimestamp%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Enumber%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Edata%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22*%22%5D%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22a8879b08a02b4b0344dd5727cc1d4244a38bec59b9df10d5fd8628479ba98504%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ESettings%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eid%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eproperties%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3EMap%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22babb7ce83e1b568cf7d36adcc8e1d6681634161233b8fa58f314084f8fae9fe5%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ESlider%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eitems%3C/span%3E%3Cspan%20itemprop=%22referenceToBlob%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22e53f1ea96bdda9dde49368d90ea2e3c0c83fddff751f1af0a4f09474cda70fcd%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EProfile%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EpersonId%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Person%22%5D%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EmainContact%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Contact%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EcontactObjects%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Contact%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22ed56272f0b645f9cb2e11aef8b3bd41d6edf938f6342e3225862eacfbd4c2242%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EMatchMap%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ename%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Earray%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22MatchResponse%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22f65d8ce15a51feb2b003ece65d99ac6bede8c37854757e7110c6da64cf267dc4%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EChannelRegistry%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eid%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22regexp%22%3E/%5EChannelRegistry$/%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Echannels%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3EMap%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22fc5f698d69b053979294f7587e60c35ecc558fb80db89a2ea54cf3a5889eb3d0%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EChannelEntry%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Edata%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22CreationTime%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eprevious%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22ChannelEntry%22%5D%3C/span%3E%3Cspan%20itemprop=%22optional%22%3Etrue%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22enabledReverseMapTypes%22%3E%5B%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22personKeys%22%20data-hash=%2201953858b2a6de7333bf07d53ca8cfb418e7ede3a78739dccc305af46bed149e%22%20itemscope%20itemtype=%22http://refin.io/Keys%22%3E%3Cspan%20itemprop=%22owner%22%20data-hash=%22614061963a88891163325a4db961323e0fe48fbf5ed0db2b7eb57e4cabd8a45e%22%20data-id-hash=%229df182a1acb53dc1e04e2d9ce8bd0df2b5e338f39488a55aa801310d15595310%22%20itemscope%20itemtype=%22http://refin.io/Person%22%3E%3Cspan%20itemprop=%22email%22%3Eperson@match.one%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22publicKey%22%3EL8DYPzU9EWXfVCSgGntpvff35Wa4kxt0wsbT78pZO3w=%3C/span%3E%3Cspan%20itemprop=%22publicSignKey%22%3ER0ETLPFBGGQ18+24TiRTdWcyKhUIX7RboGjbFgfMOUs=%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22instanceKeys%22%20data-hash=%221a103c2079b59fd4d296d26535dc98524bb86349c169d34a74df22ff2acaeb1c%22%20itemscope%20itemtype=%22http://refin.io/Keys%22%3E%3Cspan%20itemprop=%22owner%22%20data-hash=%22e73fcad108e56a3bb50a89599389d88da329f63cc3f86ecc6a198b8a9f5efc16%22%20data-id-hash=%2293015f7b1dfb103e2123e659eb69e64b6f9905a3ec7f0c24e9df3f34fcdb96a6%22%20itemscope%20itemtype=%22http://refin.io/Instance%22%3E%3Cspan%20itemprop=%22name%22%3Ematching%3C/span%3E%3Cspan%20itemprop=%22owner%22%20data-hash=%22614061963a88891163325a4db961323e0fe48fbf5ed0db2b7eb57e4cabd8a45e%22%20data-id-hash=%229df182a1acb53dc1e04e2d9ce8bd0df2b5e338f39488a55aa801310d15595310%22%20itemscope%20itemtype=%22http://refin.io/Person%22%3E%3Cspan%20itemprop=%22email%22%3Eperson@match.one%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22096d0631876899e26ef5f656e3ff7d40062677744eaf75a5830e20014b7c28a2%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ENews%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Econtent%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%220f8711e456f8778f2b65019091a3b92abe04cbdefa1ded0a85d30c46bc9aab00%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ESupplyMap%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ename%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Emap%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3EMap%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22276a177ef6f81dcaa4706abbee63fe057b060fb1908f7b532bfec63d5dff1a2e%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EPersonName%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ename%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2230239a8b5f253a9b48eab68427bef89c1651eedc5b3bdfc22160082d21f8fc2b%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ESomeone%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EmainProfile%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Profile%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eprofiles%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Profile%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%223305468853faebd79159ad91751733be41e1c8cebc18072d7095d47d614363d5%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ENotifiedUsers%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ename%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EexistingMatches%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3EMap%3C/span%3E%3Cspan%20itemprop=%22optional%22%3Etrue%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%223589ba7b14eab4d131effdaa6e5932dceeebb4dc7b2fb80ce7735d045c0dc0dd%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EDemandMap%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ename%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Emap%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3EMap%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%223978fdf0c9aca6ee649cd429e4e58ba1bd67c1b1d0ce9e4ea9dd8348d1756073%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EDemand%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eidentity%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ematch%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EisActive%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Eboolean%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Etimestamp%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Enumber%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%223c7cdffca9da49e75f313e99aacf4b426165e9b70402271aa5ade27c8866f0c1%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EContactApp%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EappId%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22regexp%22%3E/%5EContactApp$/%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eme%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Someone%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Econtacts%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Someone%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2240348df733b88ba21b4d55b2d718b52c1ce00223d97b274990d0b1c1f6466174%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EDiaryEntry%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eentry%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%224a833eb32fb86e5ccd014881cc5e6c58f5e4844cabd6e0d6b5faeaaee4c3d95b%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ELocalInstancesList%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eid%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22regexp%22%3E/%5ELocalInstancesList$/%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Einstances%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByApp%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Einstance%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Instance%22%5D%3C/span%3E%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2252244d999860b12145a2d7197fe7e8d58b3172c1fa36d261f432d37b327bdf31%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EOneInstanceEndpoint%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EpersonId%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Person%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EinstanceId%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Instance%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EpersonKeys%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Keys%22%5D%3C/span%3E%3Cspan%20itemprop=%22optional%22%3Etrue%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EinstanceKeys%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Keys%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eurl%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2258295b30525135bfd235fb6aeaeb26b40e6ad435084c1773c5bf4c6281909f08%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EChannelInfo%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eid%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eowner%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Person%22%5D%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ehead%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22ChannelEntry%22%5D%3C/span%3E%3Cspan%20itemprop=%22optional%22%3Etrue%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22585627a6633a2148b94add7f8a469d0745db2d6108eca8fd0f45590037247cd2%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EContact%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EpersonId%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Person%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EcommunicationEndpoints%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22OneInstanceEndpoint%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EcontactDescriptions%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22PersonName%22,%22ProfileImage%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22714d3803031cb602dc7f3e41123761fbf3949dfd03c3a5820bd075a617093965%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EConsentFile%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EfileData%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EfileType%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22794fb7d322606efa1c0d2d27085281050d9d604d298f92406c7cce555cdb61a6%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ESupply%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eidentity%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ematch%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EisActive%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Eboolean%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Etimestamp%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Enumber%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2288b157f7f06b4e226d1ef7d2ad7c429e00418e5bd512a19798f0e2c60fa529d0%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EBodyTemperature%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Etemperature%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%228c2869d58b7ecc573b36be02ac5edc44be73768ad422818738f148b8a7187595%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EMatchResponse%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eidentity%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ematch%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EidentityOfDemand%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Eboolean%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EcreationTimestamp%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Enumber%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%2290aa8c65ffd19aec93b51c49775330f3c8af1c21990a75f3e1b2cec77826a3bb%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EProfileImage%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eimage%3C/span%3E%3Cspan%20itemprop=%22referenceToBlob%22%3Etrue%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%229abb5cb80bd1d913877481da8f69447243dc977ae7550f0b7b73751d155b41a9%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EQuestionnaireResponse%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Equestionnaire%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eitem%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3ElinkId%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eanswer%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22a73834e0cc351a3d4bd4add8abb037d26ad33cfae75769924b01b017a86dfa11%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ECreationTime%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Etimestamp%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Enumber%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Edata%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22*%22%5D%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22a8879b08a02b4b0344dd5727cc1d4244a38bec59b9df10d5fd8628479ba98504%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ESettings%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eid%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eproperties%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3EMap%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22babb7ce83e1b568cf7d36adcc8e1d6681634161233b8fa58f314084f8fae9fe5%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3ESlider%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eitems%3C/span%3E%3Cspan%20itemprop=%22referenceToBlob%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22e53f1ea96bdda9dde49368d90ea2e3c0c83fddff751f1af0a4f09474cda70fcd%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EProfile%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EpersonId%3C/span%3E%3Cspan%20itemprop=%22referenceToId%22%3E%5B%22Person%22%5D%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EmainContact%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Contact%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3EcontactObjects%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22Contact%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22ed56272f0b645f9cb2e11aef8b3bd41d6edf938f6342e3225862eacfbd4c2242%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EMatchMap%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Ename%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3Estring%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Earray%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22MatchResponse%22%5D%3C/span%3E%3Cspan%20itemprop=%22list%22%3EorderedByONE%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22f65d8ce15a51feb2b003ece65d99ac6bede8c37854757e7110c6da64cf267dc4%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EChannelRegistry%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eid%3C/span%3E%3Cspan%20itemprop=%22isId%22%3Etrue%3C/span%3E%3Cspan%20itemprop=%22regexp%22%3E/%5EChannelRegistry$/%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Echannels%3C/span%3E%3Cspan%20itemprop=%22valueType%22%3EMap%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22recipe%22%20data-hash=%22fc5f698d69b053979294f7587e60c35ecc558fb80db89a2ea54cf3a5889eb3d0%22%20itemscope%20itemtype=%22http://refin.io/Recipe%22%3E%3Cspan%20itemprop=%22name%22%3EChannelEntry%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Edata%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22CreationTime%22%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22rule%22%3E%3Cspan%20itemprop=%22itemprop%22%3Eprevious%3C/span%3E%3Cspan%20itemprop=%22referenceToObj%22%3E%5B%22ChannelEntry%22%5D%3C/span%3E%3Cspan%20itemprop=%22optional%22%3Etrue%3C/span%3E%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22enabledReverseMapTypes%22%3E%5B%5D%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22publicKey%22%3EV8PzDqJi0DQntX6SgE3SyyU8qJGw7ZKZbgOy0A6iokw=%3C/span%3E%3C/span%3E%3Cspan%20itemprop=%22url%22%3Ewss://comm.dev.refinio.one%3C/span%3E%3C/span%3E%3C/span%3E');

/**
 * Inheriting the common behaviour from the Matching Model class, this
 * class implements the specific behaviour for the client of the matching
 * server.
 *
 * The identity of the matching server is read from the json file and the
 * Contact object is memorised in order to establish a connection between
 * the client and the server.
 *
 * @description Client Matching Model class
 * @augments MatchingModel
 */
export default class ClientMatchingModel extends MatchingModel {
    /**
     * Event is emitted when:
     * - a supply object is created
     * - a supply object is deleted
     * - the active status of the supply is changed
     */
    public onSupplyUpdate = new OEvent<() => void>();
    /**
     * Event is emitted when:
     * - a demand object is created
     * - a demand object is deleted
     * - the active status of the demand is changed
     */
    public onDemandUpdate = new OEvent<() => void>();
    /**
     * Event is emitted when a new supply or demand object is received.
     */
    public onCatalogUpdate = new OEvent<() => void>();
    /**
     * Event is emitted when a new match is found.
     */
    public onMatchUpdate = new OEvent<() => void>();

    private matchMapName = 'MatchMap';

    protected anonInstancePersonEmail: string | null;
    private matchingServerPersonIdHash: SHA256IdHash<Person> | undefined;

    constructor(channelManager: ChannelManager) {
        super(channelManager);
        this.anonInstancePersonEmail = null;
        this.matchingServerPersonIdHash = undefined;
    }

    /**
     * 1. read the matching server details from the json file and memorise
     * the corresponding Contact object in order to establish a connection
     * with it.
     *
     * 2. initialise application resources (all maps that are used to memorising
     * the data) and load the instance information in memory.
     *
     * 3. start the channels and add listeners for specific objects
     *
     * 4. share the channel with the matching server
     */
    async init() {
        this.state.assertCurrentState('Uninitialised');

        /*const importedMatchingContact: UnversionedObjectResult<Contact>[] =
            await createManyObjectsThroughPurePlan(
                {
                    module: '@module/explodeObject',
                    versionMapPolicy: {'*': VERSION_UPDATES.NONE_IF_LATEST}
                },
                decodeURI(MATCHING_CONTACT)
            );
        this.matchingServerPersonIdHash = importedMatchingContact[0].obj.personId;

        await this.initialiseMaps();
        await this.updateInstanceInfo();

        if (this.anonInstanceInfo && this.anonInstanceInfo.personId) {
            const person = (await getObjectByIdHash(
                this.anonInstanceInfo.personId
            )) as VersionedObjectResult<Person>;

            this.anonInstancePersonEmail = person.obj.email;
        }

        await this.startMatchingChannel();
        await this.registerHooks();

        const personsToGiveAccessTo = this.anonInstanceInfo
            ? [this.matchingServerPersonIdHash, this.anonInstanceInfo.personId]
            : [this.matchingServerPersonIdHash];
        await this.giveAccessToMatchingChannel(personsToGiveAccessTo);*/
        this.state.triggerEvent('init');
    }

    /**
     * Given the match value a Supply object is created and posted to the channel.
     *
     * @param supplyInput
     */
    async sendSupplyObject(supplyInput: string): Promise<void> {
        await serializeWithType('Supply', async () => {
            if (this.anonInstancePersonEmail === null) {
                return;
            }
            const supply = (await storeUnversionedObject({
                $type$: 'Supply',
                identity: this.anonInstancePersonEmail,
                match: supplyInput,
                isActive: true,
                timestamp: Date.now()
            })) as UnversionedObjectResult<Supply>;

            // remember the Supply object that was created
            this.addNewValueToSupplyMap(supply.obj);
            await this.memoriseLatestVersionOfSupplyMap();

            await this.channelManager.postToChannelIfNotExist(MatchingModel.channelId, supply.obj);

            this.onSupplyUpdate.emit();
        });
    }

    /**
     * Given the match value a Demand object is created and posted to the channel.
     *
     * @param demandInput
     */
    async sendDemandObject(demandInput: string): Promise<void> {
        await serializeWithType('Demand', async () => {
            if (this.anonInstancePersonEmail === null) {
                return;
            }
            const demand = (await storeUnversionedObject({
                $type$: 'Demand',
                identity: this.anonInstancePersonEmail,
                match: demandInput,
                isActive: true,
                timestamp: Date.now()
            })) as UnversionedObjectResult<Demand>;

            // remember the Demand object that was created
            this.addNewValueToDemandMap(demand.obj);
            await this.memoriseLatestVersionOfDemandMap();

            await this.channelManager.postToChannelIfNotExist(MatchingModel.channelId, demand.obj);

            this.onDemandUpdate.emit();
        });
    }

    /**
     * Return all Supply objects that were created by myself.
     *
     * @returns
     */
    getMySupplies(): Supply[] {
        const mySupplies: Supply[] = [];
        this.suppliesMap.forEach(supplyArray => {
            supplyArray.forEach(supplyObj => {
                if (supplyObj.identity === this.anonInstancePersonEmail) {
                    mySupplies.push(supplyObj);
                }
            });
        });

        return mySupplies;
    }

    /**
     * Return all Demands objects that were created by myself.
     *
     * @returns
     */
    getMyDemands(): Demand[] {
        const myDemands: Demand[] = [];
        this.demandsMap.forEach(demandArray => {
            demandArray.forEach(demandObj => {
                if (demandObj.identity === this.anonInstancePersonEmail) {
                    myDemands.push(demandObj);
                }
            });
        });

        return myDemands;
    }

    /**
     * Returns all existing match property that correspond to the
     * Supply and Demand objects found (created by myself and
     * retrieved from the matching server via channels).
     *
     * @returns
     */
    getAllAvailableSuppliesAndDemands(): Array<string> {
        const allObjects: string[] = [];
        this.demandsMap.forEach(allDemands => {
            allDemands.forEach(demand => {
                allObjects.push(demand.match);
            });
        });
        this.suppliesMap.forEach(allSupplies => {
            allSupplies.forEach(supply => {
                allObjects.push(supply.match);
            });
        });

        return [...new Set(allObjects)];
    }

    /**
     * Returns the array with all existing matches for this instance.
     *
     * @returns
     */
    async getAllMatchResponses(): Promise<MatchResponse[]> {
        const matchMap: MatchResponse[] = [];

        try {
            const matchMapObj = await getObjectByIdObj({
                $type$: 'MatchMap',
                name: this.matchMapName
            });

            if (!matchMapObj.obj.array) {
                return matchMap;
            }

            for await (const matchResponseHash of matchMapObj.obj.array) {
                const matchResponse = await getObject(matchResponseHash);
                matchMap.push(matchResponse);
            }
        } catch (error) {
            if (error.name !== 'FileNotFoundError') {
                throw error;
            }
        }

        return matchMap;
    }

    /**
     * For the Supply objects that were created by myself I
     * have complete control over them so I can also delete
     * an object and remove it from the list, but the object
     * will still be visible in the server list.
     *
     * @param supplyValue
     */
    async deleteSupply(supplyValue: string): Promise<void> {
        this.suppliesMap.delete(supplyValue);
        await this.memoriseLatestVersionOfSupplyMap();
        this.onSupplyUpdate.emit();
    }

    /**
     * For the Demand objects that were created by myself I
     * have complete control over them so I can also delete
     * an object and remove it from the list, but the object
     * will still be visible in the server list.
     *
     * @param demandValue
     */
    async deleteDemand(demandValue: string): Promise<void> {
        this.demandsMap.delete(demandValue);
        await this.memoriseLatestVersionOfDemandMap();
        this.onDemandUpdate.emit();
    }

    /**
     * This function changes the status of a Supply from active to
     * inactive or the other way depending on the actual status of
     * the tag and the user clicking on it.
     *
     * The old version of the Supply object will be deleted from memory
     * and oly the new version will be remembered.
     *
     * @param supplyMatch
     */
    async changeSupplyStatus(supplyMatch: string): Promise<void> {
        const supplyArray = this.suppliesMap.get(supplyMatch);

        // check if there is a Supply object with the given match
        if (!supplyArray) {
            return;
        }

        await serializeWithType('Supply', async () => {
            if (this.anonInstancePersonEmail === null) {
                return;
            }

            // a person can create only one Supply object with a specific match
            const availableSupply = supplyArray.find(
                supplyObj => supplyObj.identity === this.anonInstancePersonEmail
            );

            // if the existing Supply object does not belong to the current user the
            // active state can not be changed
            if (!availableSupply) {
                return;
            }

            // create the new version of the Supply object
            const newSupply = (await storeUnversionedObject({
                $type$: 'Supply',
                identity: this.anonInstancePersonEmail,
                match: supplyMatch,
                isActive: !availableSupply.isActive,
                timestamp: availableSupply.timestamp
            })) as UnversionedObjectResult<Supply>;

            // delete the old version of the Supply object
            this.suppliesMap.delete(availableSupply.match);

            // remember the new version of the Supply object
            this.addNewValueToSupplyMap(newSupply.obj);
            await this.memoriseLatestVersionOfSupplyMap();

            await this.channelManager.postToChannelIfNotExist(
                MatchingModel.channelId,
                newSupply.obj
            );

            this.onSupplyUpdate.emit();
        });
    }

    /**
     * This function changes the status of a Demand from active to
     * inactive or the other way depending on the actual status of
     * the tag and the user clicking on it.
     *
     * The old version of the Demand object will be deleted from memory
     * and oly the new version will be remembered.
     *
     * @param value
     */
    async changeDemandStatus(value: string): Promise<void> {
        const demandArray = this.demandsMap.get(value);

        // check if there is a Demand object with the given match
        if (!demandArray) {
            return;
        }

        await serializeWithType('Demand', async () => {
            if (this.anonInstancePersonEmail === null) {
                return;
            }

            // a person can create only one Demand object with a specific match
            const availableDemand = demandArray.find(
                demandObj => demandObj.identity === this.anonInstancePersonEmail
            );

            // if the existing Demand object does not belong to the current user the
            // active state can not be changed
            if (!availableDemand) {
                return;
            }

            // create the new version of the Demand object
            const newDemand = (await storeUnversionedObject({
                $type$: 'Demand',
                identity: this.anonInstancePersonEmail,
                match: value,
                isActive: !availableDemand.isActive,
                timestamp: availableDemand.timestamp
            })) as UnversionedObjectResult<Demand>;

            // delete the old version of the Demand object
            this.demandsMap.delete(availableDemand.match);

            // remember the new version of the Demand object
            this.addNewValueToDemandMap(newDemand.obj);
            await this.memoriseLatestVersionOfDemandMap();

            await this.channelManager.postToChannelIfNotExist(
                MatchingModel.channelId,
                newDemand.obj
            );

            this.onDemandUpdate.emit();
        });
    }

    // ################ PRIVATE API ################

    /**
     * When MatchResponse, Supply and Demands objects are retrieved the client
     * has to remember them and emit the corresponding event type.
     *
     * @private
     */
    private registerHooks(): void {
        objectEvents.onUnversionedObject(
            async caughtObject => {
                try {
                    const receivedObject = await getObject(caughtObject.obj.data);

                    if (receivedObject.$type$ === 'Supply') {
                        if (MatchingModel.checkIfItIsAnUpdate(this.suppliesMap, receivedObject)) {
                            this.updateSupplyInSupplyMap(receivedObject);
                        } else {
                            this.addNewValueToSupplyMap(receivedObject);
                        }

                        await this.memoriseLatestVersionOfSupplyMap();
                        this.onCatalogUpdate.emit();
                    } else if (receivedObject.$type$ === 'Demand') {
                        if (MatchingModel.checkIfItIsAnUpdate(this.demandsMap, receivedObject)) {
                            this.updateDemandInDemandMap(receivedObject);
                        } else {
                            this.addNewValueToDemandMap(receivedObject);
                        }

                        await this.memoriseLatestVersionOfDemandMap();
                        this.onCatalogUpdate.emit();
                    }
                } catch (err) {
                    if (err.name !== 'FileNotFoundError') {
                        throw err;
                    }
                }
            },
            'ClientMatchingModel: New creation time object',
            'CreationTime'
        );
        objectEvents.onUnversionedObject(
            async caughtObject => {
                /**
                 * The Match Response object is sent directly to the designated
                 * person without using the channels.
                 *
                 * The type conversion is necessary because the caughtObject in a generic
                 * UnversionedObjectResult.
                 */
                await this.memoriseMatchResponse(caughtObject.hash);
            },
            'ClientMatchingModel: New match response',
            'MatchResponse'
        );
    }

    /**
     * When a match is found the result is memorised so the user
     * can be notified about it's latest match even after application
     * reload.
     *
     * @param matchResponseHash
     */
    private async memoriseMatchResponse(
        matchResponseHash: SHA256Hash<MatchResponse>
    ): Promise<void> {
        await serializeWithType('MatchResponse', async () => {
            try {
                const matchMapObj = await getObjectByIdObj({
                    $type$: 'MatchMap',
                    name: this.matchMapName
                });

                let existingMatches = matchMapObj.obj.array;

                if (existingMatches && !existingMatches.includes(matchResponseHash)) {
                    existingMatches.push(matchResponseHash);
                }

                if (!existingMatches) {
                    existingMatches = [matchResponseHash];
                }

                await storeVersionedObject({
                    $type$: 'MatchMap',
                    name: this.matchMapName,
                    array: existingMatches
                });
            } catch (_) {
                await storeVersionedObject({
                    $type$: 'MatchMap',
                    name: this.matchMapName,
                    array: [matchResponseHash]
                });
            }
            this.onMatchUpdate.emit();
        });
    }
}
