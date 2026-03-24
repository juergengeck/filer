/*
 * This interface just tells typescript, that you now can directly call the class like a function.
 */
export interface Functor<T extends (...arg: any) => any> {
    (...args: Parameters<T>): ReturnType<T>;
}

/**
 * This class is for overriding the parenthesis operator "()" of a class.
 *
 * Javascript / typescript don't support overriding operators. But you can use a trick by creating a function when 'new'
 * is called and making the original class a prototype of the returned function.
 *
 * Deriving from 'Function' is not really required, but with it you get all the members of a function object.
 *
 * Note: This redefines the prototype of a function with setPrototypeOf. According to MDN this might come with severe
 * speed penalties, because this will disable some optimizations in certain runtimes.
 * - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/setPrototypeOf
 *
 * **Q**: How does this thing work?<br>
 * **A**: Read about prototype inheritance, then you might understand the explanation at the top of this comment. Also the
 *    first link will show you how it is done in javascript which is the same.
 * - https://stackoverflow.com/questions/36871299/how-to-extend-function-with-es6-classes/36871498#36871498
 * - http://dmitrysoshnikov.com/ecmascript/javascript-the-core/
 * - https://stackoverflow.com/questions/340383/can-a-javascript-object-have-a-prototype-chain-but-also-be-a-function
 * - https://stackoverflow.com/questions/650764/how-does-proto-differ-from-constructor-prototype/11249437#11249437
 * - https://stackoverflow.com/questions/9959727/proto-vs-prototype-in-javascript
 * - https://medium.com/@happymishra66/inheritance-in-javascript-21d2b82ffa6f
 *
 * **Q**: Why is the functor interface needed?<br>
 * **A**: Because it extends the type of the class in a way that the class is considered callable by typescript.
 *    It does not make it callable - that is achieved by the setPrototypeOf call in the class constructor
 * - https://stackoverflow.com/questions/38338013/can-you-extend-a-function-in-typescript/55676767#55676767 ()
 *
 * **Q**: What is the single unnamed parameter in the functor interface?<br>
 * **A**: That the interface is directly callable
 * - https://www.typescriptlang.org/docs/handbook/interfaces.html#hybrid-types<br>
 */
export class Functor<T extends (...arg: any) => any> extends Function {
    /**
     * Constructs the callable class.
     *
     * @param f - The function that is invoked when the () operator is invoked. If you use an arrow function in the
     *            derived class you can safely use 'this'.
     */
    constructor(f: (...args: Parameters<T>) => any) {
        super();
        return Object.setPrototypeOf(f, new.target.prototype);
    }
}
