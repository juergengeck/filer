# ONE Data Type Definitions v2.0

<span style="text-decoration:underline;">(sebastian@refinio.net)</span>



1. Overview

   This document explains the features and the changes that took place on the recipes. The recipe revamp consists in a more flexible & easier way to define new types for CORE persisted objects. Readability & type-checking were slightly improved with this update, preventing us from having types inside objects we didn’t want & making the new defined recipes crystal-clear on their form. Recursiveness and delegation were used in order to accomplish a new code structure that leaves room for any future development on the recipes (adding new types or changing/improving the microdata). Besides that, new HTML tags were introduced in order to match the present type in the microdata. Nevertheless, the file size was reduced for some objects by removing any not-needed properties in some tags. Object links are now found by the responsible module in any data structure if the links are defined in the type, without caring about their nested level.


> In other words, this update solidifies the ONE type structure, making it an almost complete 
> type system (combined types in list structures are not possible). 

2. Accepted types

   The accepted types are the following: 


<table>
  <tr>
   <td>
<strong>Name</strong>
   </td>
   <td><strong>Description</strong>
   </td>
   <td><strong>Options</strong>
   </td>
  </tr>
  <tr>
   <td>StringValue
   </td>
   <td>Used for strings
   </td>
   <td>
<ul>

<li><span style="text-decoration:underline;">regexp</span>: apply regular expression on the given string
</li>
</ul>
   </td>
  </tr>
  <tr>
   <td>IntegerValue
   </td>
   <td>Used for integers
   </td>
   <td>
<ul>

<li><span style="text-decoration:underline;">min</span>: minimum value 

<li><span style="text-decoration:underline;">max</span>: maximum value
</li>
</ul>
   </td>
  </tr>
  <tr>
   <td>NumberValue
   </td>
   <td>Used for numbers
   </td>
   <td>
<ul>

<li><span style="text-decoration:underline;">min</span>: minimum value 

<li><span style="text-decoration:underline;">max</span>: maximum value
</li>
</ul>
   </td>
  </tr>
  <tr>
   <td>BooleanValue
   </td>
   <td>Used for booleans
   </td>
   <td>-
   </td>
  </tr>
  <tr>
   <td>StringifiableValue
   </td>
   <td>Used for anything that can be stringified
   </td>
   <td>-
   </td>
  </tr>
  <tr>
   <td>ReferenceToObjValue
   </td>
   <td>Used for Unversioned Object reference/s
   </td>
   <td>
<ul>

<li><span style="text-decoration:underline;">allowedTypes</span>: to which kind of object the hashes points to
</li>
</ul>
   </td>
  </tr>
  <tr>
   <td>ReferenceToIdValue
   </td>
   <td>Used for Versioned Object reference/s
   </td>
   <td>
<ul>

<li><span style="text-decoration:underline;">allowedTypes</span>: to which kind of object the hashes points to
</li>
</ul>
   </td>
  </tr>
  <tr>
   <td>ReferenceToClobValue
   </td>
   <td>Used for CLOB object reference/s
   </td>
   <td>-
   </td>
  </tr>
  <tr>
   <td>ReferenceToBlobValue
   </td>
   <td>Used for BLOB object reference/s
   </td>
   <td>-
   </td>
  </tr>
  <tr>
   <td>MapValue
   </td>
   <td>Used for Map Objects
   </td>
   <td>
<ul>

<li><span style="text-decoration:underline;">key</span>: the type of the key

<li><span style="text-decoration:underline;">value</span>: the type of the value
</li>
</ul>
   </td>
  </tr>
  <tr>
   <td>BagValue
   </td>
   <td>Used for ordered lists
<p>
(ORDERED_BY.CORE)
   </td>
   <td>
<ul>

<li><span style="text-decoration:underline;">item</span>: the type of each item 
</li>
</ul>
   </td>
  </tr>
  <tr>
   <td>ArrayValue
   </td>
   <td>Used for unordered lists
<p>
(ORDERED_BY.APP)
   </td>
   <td>
<ul>

<li><span style="text-decoration:underline;">item</span>: the type of each item 
</li>
</ul>
   </td>
  </tr>
  <tr>
   <td>SetValue
   </td>
   <td>Used for Set objects
   </td>
   <td>
<ul>

<li><span style="text-decoration:underline;">item</span>: the type of each item 
</li>
</ul>
   </td>
  </tr>
  <tr>
   <td>ObjectValue
   </td>
   <td>Used for nested ONE objects
   </td>
   <td>
<ul>

<li><span style="text-decoration:underline;">rules</span>: define nested objects
</li>
</ul>
   </td>
  </tr>
</table>



    The following subtitles presents how the microdata is looking for each type. NOTE: itemprop is not present if the microdata is nested, only for objects.

2.1. <span style="text-decoration:underline;">StringValue</span>

		{..., stringField: ‘Lorem Ipsum’} 

		⇾ to microdata

		<span itemprop=”stringField”>Lorem Ipsum</span>

2.2. <span style="text-decoration:underline;">IntegerValue</span>


    {..., integerField: 7} 

		⇾ to microdata

		<span itemprop=”integerField”>7</span>

2.3. <span style="text-decoration:underline;">NumberValue</span>


    {..., numberField: 7.77} 

		⇾ to microdata

		<span itemprop=”numberField”>7.77</span>

2.4. <span style="text-decoration:underline;">BooleanValue</span>


    {..., booleanField: true} 

		⇾ to microdata

		<span itemprop=”booleanField”>true</span>

2.5. <span style="text-decoration:underline;">StringifiableValue</span>


    {..., stringifiableField: true} 

		⇾ to microdata


    <span itemprop=”stringifiableField”>       {"array":{"item":{"string":{},"type":"string"}},"type":"array"}


    </span>

2.6. <span style="text-decoration:underline;">ReferenceToObjValue</span>


    {..., referenceToObj: ‘96b88fae53f592899aa81b1f406ef05cd20630e6119b2589a034996562e63544’}


    ⇾ to microdata


    <a itemprop=”referenceToObj” data-type=”obj””>96b88fae53f592899aa81b1f406ef05cd20630e6119b2589a034996562e63544</a>

2.7. <span style="text-decoration:underline;">ReferenceToIdValue</span>


    {..., referenceToId: ‘7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3’}


    ⇾ to microdata


    <a itemprop=”referenceToId” data-type=”id”>7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3</a>

2.8. <span style="text-decoration:underline;">ReferenceToClobValue</span>


    {..., referenceToClob: ‘7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3’}


    ⇾ to microdata


    <a itemprop=”referenceToClob” data-type=”clob”>7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3</a>

2.9. <span style="text-decoration:underline;">ReferenceToBlobValue</span>


    {..., referenceToBlob: ‘7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3’}


    ⇾ to microdata


    <a itemprop=”referenceToBlob” data-type=”blob”>7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3</a>

2.10. <span style="text-decoration:underline;">MapValue</span>


        {..., mapField: new Map([[‘key’, ‘value’]]) }


    ⇾ to microdata


    <dl itemprop=”mapField”>


    	<dt>key</dt>


    	<dd>value</dd>


    </dl>

2.11. <span style="text-decoration:underline;">BagValue</span>


        {..., bagField: [‘item’] }


    ⇾ to microdata


    <ol itemprop=”bagField”>


    	<li>item</li>


    </ol>

2.12. <span style="text-decoration:underline;">ArrayValue</span>


        {..., arrayField: [‘item’] }


    ⇾ to microdata


    <ul itemprop=”arrayField”>


    	<li>item</li>


    </ul>

2.13. <span style="text-decoration:underline;">SetValue</span>


        {..., setField: new Set([‘item’]) }


    ⇾ to microdata


    <ol itemprop=”bagField”>


    	<li>item</li>


    </ol>

2.14 <span style="text-decoration:underline;">ObjectValue</span>


        {..., object: {string: [‘Lorem Ipsum’] } }


    ⇾ to microdata


        <div itemprop=”object”>

   			<ul itemprop="string">


          	<li>Lorem Ipsum</li>

   			</ul>

   		</div>

2.15 <span style="text-decoration:underline;">More complex example</span>


    {


                $type$: 'OneTest$KeyValueMap',


                name: 'Test Map',


                item: [


                    {


                        key: 'key1',


                        value: ['v1-1', 'v1-2', 'v1-3', 'v1-4', 'v1-5']


                    },


                    {


                        key: 'key2',


                        value: ['v2-1', 'v2-2', 'v2-3']


                    },


                    {


                        key: 'key3',


                        value: ['v3-1', 'v3-2']


                    }


                ]


    }


    ⇾ to microdata


    <div itemscope itemtype="//refin.io/OneTest$KeyValueMap">


      <span itemprop="name">Test Map</span>


      <ul itemprop="item">


        <li>


          <div>


            <span itemprop="key">key1</span>


            <ul itemprop="value">


              <li>v1-1</li>


              <li>v1-2</li>


              <li>v1-3</li>


              <li>v1-4</li>


              <li>v1-5</li>


            </ul>


          </div>


        </li>


        <li>


          <div>


            <span itemprop="key">key2</span>


            <ul itemprop="value">


              <li>v2-1</li>


              <li>v2-2</li>


              <li>v2-3</li>


            </ul>


          </div>


        </li>


        <li>


          <div>


            <span itemprop="key">key3</span>


            <ul itemprop="value">


              <li>v3-1</li>


              <li>v3-2</li>


            </ul>


          </div>


        </li>


      </ul>


    </div>



3. Project Migration

   The required changes in order to migrate any project to the new structure consists in modifying the recipes. Below are the changes that took place and a few examples.





Changes in the RecipeRule type:




* <span style="text-decoration:underline;">referenceToObj</span>, <span style="text-decoration:underline;">referenceToId</span>, <span style="text-decoration:underline;">referenceToClob</span>, <span style="text-decoration:underline;">referenceToBlob </span>fields were removed
* <span style="text-decoration:underline;">regexp </span>field was removed
* <span style="text-decoration:underline;">rule </span>field was removed
* <span style="text-decoration:underline;">list </span>field was removed
* <span style="text-decoration:underline;">valueType </span>field is now called itemtype

  
The [RecipeRule](https://github.com/refinio/one.core/blob/CORE-39/NativeMapSupport_SS/src/recipes.ts#L1173) is now looking like this: 



```
export interface RecipeRule {
    itemprop: string;
        itemtype?: ValueType;
        optional?: boolean;
        isId?: boolean;
        inheritFrom?: string | RuleInheritanceWithOptions;
}
```



[ValueType](https://github.com/refinio/one.core/blob/CORE-39/NativeMapSupport_SS/src/recipes.ts#L76) is an union of the following types: `StringValue, IntegerValue, NumberValue, BooleanValue, StringifiableValue, ReferenceToObjValue, ReferenceToIdValue, ReferenceToClobValue, ReferenceToBlobValue, MapValue, BagValue, ArrayValue, SetValue & ObjectValue`


Each one of these types have a [type](https://github.com/refinio/one.core/blob/CORE-39/NativeMapSupport_SS/src/recipes.ts#L97) field and their options (consult the type table to see each option of each type or explore the types in [code](https://github.com/refinio/one.core/blob/CORE-39/NativeMapSupport_SS/src/recipes.ts#L76)).


Bellow are a few examples on how to translate to new recipes: 

<span style="text-decoration:underline;">1. Keys Recipe</span>


```
    {
       $type$: 'Recipe',
       name: 'Keys',
       rule: [
           {
               itemprop: 'owner',
               referenceToId: new Set(['Instance', 'Person'])
           },
           {
               itemprop: 'publicKey',
               regexp: /^[A-Za-z0-9+/]{43}=$/
           },
           {
               itemprop: 'publicSignKey',
               regexp: /^[A-Za-z0-9+/]{43}=$/,
               optional: true
           }
       ]
    }
```



    ⇾ translated to the new structure




```
     {
        $type$: 'Recipe',
        name: 'Keys',
        rule: [
         {
           itemprop: 'owner',
           itemtype: {
               type: 'referenceToId',
               allowedTypes: new Set(['Instance', 'Person'])
           }
       },
       {
           itemprop: 'publicKey',
           itemtype: {
               type: 'string',
               regexp: /^[A-Za-z0-9+/]{43}=$/
           }
       },
       {
           itemprop: 'publicSignKey',
           itemtype: {
               type: 'string',
               regexp: /^[A-Za-z0-9+/]{43}=$/
           },
           optional: true
       }
   ]
}
```


<span style="text-decoration:underline;">2. Instance Recipe</span>




```
   $type$: 'Recipe',
   name: 'Instance',
   rule: [
       {
           itemprop: 'name',
           isId: true
       },
       {
           itemprop: 'owner',
           referenceToId: new Set(['Person']),
           isId: true
       },
       {
           itemprop: 'recipe',
           referenceToObj: new Set(['Recipe']),
           list: ORDERED_BY.ONE
       },
       {
           itemprop: 'module',
           referenceToObj: new Set(['Module']),
           list: ORDERED_BY.ONE
       },
       {
           itemprop: 'enabledReverseMapTypes',
           valueType: 'Map'
       }
   ]
}
```



    ⇾ translated to the new structure




```
   $type$: 'Recipe',
   name: 'Instance',
   rule: [
       {
           itemprop: 'name',
           isId: true
       },
       {
           itemprop: 'owner',
           itemtype: {
               type: 'referenceToId',
               allowedTypes: new Set(['Person'])
           },
           isId: true
       },
       {
           itemprop: 'recipe',
           itemtype: {
               type: 'bag',
               item: {
                   type: 'referenceToObj',
                   allowedTypes: new Set(['Recipe'])
               }
           }
       },
       {
           itemprop: 'module',
           itemtype: {
               type: 'bag',
               item: {
                   type: 'referenceToObj',
                   allowedTypes: new Set(['Module'])
               }
           }
       },
       {
           itemprop: 'enabledReverseMapTypes',
           itemtype: {
               type: 'map',
               key: {
                   type: 'string'
               },
               value: {
                   type: 'stringifiable'
               }
           }
       }
   ]
}
```


<span style="text-decoration:underline;">3. OneTest$NESTED_CRDT Recipe</span>


```
{
   $type$: 'Recipe',
   name: 'OneTest$NESTED_CRDT',
   rule: [
       {
           itemprop: 'id',
           valueType: 'string',
           isId: true
       },
       {
           itemprop: 'hashListStrOne',
           referenceToObj: new Set(['OneTest$UnversionedReferenceListTest']),
           list: ORDERED_BY.ONE
       },
       {
           itemprop: 'idHashListStrOne',
           referenceToId: new Set(['OneTest$VersionedReferenceListTest']),
           list: ORDERED_BY.ONE
       },
       {
           itemprop: 'rule',
           rule: [
               {
                   itemprop: 'rstr',
                   valueType: 'string'
               },
               {
                   itemprop: 'hashrlistStrOne',
                   referenceToObj: new Set(['OneTest$UnversionedReferenceListTest']),
                   list: ORDERED_BY.ONE
               }
           ]
       }
   ]
}
```



    ⇾ translated to the new structure


```
{
   $type$: 'Recipe',
   name: 'OneTest$NESTED_CRDT',
   rule: [
       {
           itemprop: 'id',
           itemtype: {type: 'string'},
           isId: true
       },
       {
           itemprop: 'hashListStrOne',
           itemtype: {
               type: 'bag',
               item: {
                   type: 'referenceToObj',
                   allowedTypes: new Set(['OneTest$UnversionedReferenceListTest'])
               }
           }
       },
       {
           itemprop: 'idHashListStrOne',
           itemtype: {
               type: 'bag',
               item: {
                   type: 'referenceToId',
                   allowedTypes: new Set(['OneTest$VersionedReferenceListTest'])
               }
           }
       },
       {
           itemprop: 'rule',
           itemtype: {
               type: 'object',
               rules: [
                   {
                       itemprop: 'rstr',
                       itemtype: {type: 'string'}
                   },
                   {
                       itemprop: 'hashrlistStrOne',
                       itemtype: {
                           type: 'bag',
                           item: {
                               type: 'referenceToObj',
                               allowedTypes: new Set(['OneTest$UnversionedReferenceListTest'])
                           }
                       }
                   }
               ]
           }
       }
   ]
}

```



4. Parsers

<span style="text-decoration:underline;">4.1. Object to microdata</span>

The Object-to-microdata parser will create the microdata by looking at the given object and his recipe. For each field, it will create the microdata as described in the II Chapter.

<span style="text-decoration:underline;">4.2. Microdata to object</span>

The Microdata-to-object parser always knows what to expect, it creates isolated contexts for complex types and it goes recursively on their types & microdata.

Take this object type for example. It has a field called:



* “string” (which is an array of strings that needs to match the regular expression “`/^[\w"'\s]*$/`“
* “boolean” (which is an array of booleans)
* “number” (which is an array of numbers)
* “integer” (which is an array of integers)
* “object” (which can be any object)
* “arrayOfMapsWithStrings” (which is an array of Map Objects that have a string as a key and an array of strings that need to match the regular expression as a value). This field can be described in the recipe like this:

Bellow is the recipe for this kind of object


```
{
   $type$: 'Recipe',
   name: 'OneTest$TypeTest2',
   rule: [
       {
           itemprop: 'string',
           itemtype: {
               type: 'array',
               item: {
                       type: 'string',
                       string: {regexp: /^[\w"'\s]*$/}
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
                       type: 'number',
                       number: {}
               }
           },
           optional: true
       },
       {
           itemprop: 'integer',
           itemtype: {
               type: 'array',
               item: {
                       type: 'integer',
                       integer: {}
               }
           },
           optional: true
       },
       {
           itemprop: 'object',
           itemtype: {type: 'stringifiable'},
           optional: true
       }
   ]
},
```


Moving forward, this object would look like this.


```
{
   $type$: 'OneTest$TypeTest2',
   string: ['winfried \'win\'fried\' "winfried""', ''],
   boolean: [true, false],
   number: [123.123, 42, 1.2e23, 0.01],
   integer: [123, 42, 1, 0],
   object: [
       {
           array: [],
           set: new Set([1, 2, 3]),
           bar: 'foo',
           map: new Map([
               ['key1', 'value1'],
               ['key2', 'value2']
           ])
       },
       [1, 2, 3],
       42
   ]
}
```


Converting this object to microdata would look like this (each color represents a field of the object translated to microdata)
``` html
<div itemscope itemtype="//refin.io/OneTest$TypeTest2">

<ul itemprop="string">

    <li>winfried 'win'fried' "winfried""</li>

    <li></li>

</ul>

<ul itemprop="boolean">

    <li>true</li>

    <li>false</li>

</ul>

<ul itemprop="number">

    <li>123.123</li>

    <li>42</li>

    <li>1.2e+23</li>

    <li>0.01</li>

</ul>

<ul itemprop="integer">

    <li>123</li>

    <li>42</li>

    <li>1</li>

    <li>0</li>

</ul>

<span itemprop="object">[{"array":[],"bar":"foo","map":[["key1","value1"],["key2","value2"]],"set":[1,2,3]},[1,2,3],42]

</span>

</div>
```
Let's take the easiest one and see how the parser works. Consider this isolated microdata for now. Imagine each color will go to the same workflow until the object is finally built.
``` html
<ul itemprop="string">

    <li>winfried 'win'fried' "winfried""</li>

    <li></li>

</ul>
```
Steps:



* the parser will iterate over the “OneTest$TypeTest2” rules
* the parser will see the first rule of the object, which is for the “string” field. This rule looks like this

    ``` javascript
    {
       itemprop: 'string',
       itemtype: {
           type: 'array',
           item: {
                   type: 'string',
                   string: {regexp: /^[\w"'\s]*$/}
           }
       },
       optional: true
    }
    ```

* the parser knows what to expect at first, it sees the “ type: ‘array’ “ so it checks for <ul 
  itemprop=”string”>.
* after the check, it will create an array of ```<li> </li>``` items. E.g ```[‘<li>winfried 'win'fried' 
  "winfried""</li>’ , ‘<li></li>’]```
* for each item in the list, it will go recursively knowing each item type using a new isolated 
  context (index position starts from 0) . E.g {item: {type: ‘string’, regexp: ... }
* the parser will check if the given value inside the ```<li> </li>``` matches the regular expression
* (if everything goes well) it will come back from the recursive call with the strings, 
  resulting in ['winfried \'win\'fried\' "winfried""', '']
* will change the CONTEXT.position to the end of the ```</ul>``` tag


<span style="text-decoration:underline;">4.3. Auxiliary modules</span>

The following modules were also affected by the recipe change. Their code were adapted in order to match the new structure:



* microdata-exploder
* microdata-imploder
* microdata-to-id-hash
* microdata-to-json
* CRDTs
