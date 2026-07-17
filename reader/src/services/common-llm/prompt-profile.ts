import { COERCIBLE_OPTIONS_SYMBOL, Coercible, inputSingle } from 'civkit/coercible';
import { AbstractLLM, LLMDto, LLMModelOptions } from './base';
import { Readable } from 'stream';
import { FunctionCallingAwareLLMMessage, FunctionCallingAwareLLMModelOptions, LLMFunctionCallRequest } from './misc';


export interface PromptProfileRuntimeMetadata {
    modelName: string;
    model: AbstractLLM<unknown>;
    prompt: string | FunctionCallingAwareLLMMessage[];
    modelOptions: FunctionCallingAwareLLMModelOptions<unknown>;
    iterations: { input: FunctionCallingAwareLLMModelOptions<unknown>, output?: Readable | string | LLMDto | LLMFunctionCallRequest; }[];
}

export abstract class PromptProfile<T = unknown> extends Coercible {

    abstract modelOutput?: LLMDto | string | string[] | number | boolean | Readable | Readable[];
    runtime?: PromptProfileRuntimeMetadata;

    selectModel(): string | Promise<string> {
        return 'default';
    }

    renderSystemPrompt(): string | undefined | Promise<string> | Promise<undefined> {
        return undefined;
    }

    renderModelOptions(): LLMModelOptions<T> | Promise<LLMModelOptions<T>> | Promise<undefined> | undefined {
        return undefined;
    }

    abstract renderPrompt(): string | FunctionCallingAwareLLMMessage[] | Promise<string | FunctionCallingAwareLLMMessage[]>;

    get modelOutputDto() {
        const theConstructor = this.constructor as typeof Coercible;
        const opts = theConstructor[COERCIBLE_OPTIONS_SYMBOL];

        const expectedType = opts?.['modelOutput']?.type;

        if (!expectedType) {
            throw new Error('Invalid modelOutput type');
        }

        if (Array.isArray(expectedType)) {
            throw new Error('Invalid modelOutput type');
        }

        return expectedType;
    }

    async acceptModelOutput(parsed: typeof this.modelOutput, raw: string): Promise<boolean> {
        const theConstructor = this.constructor as typeof Coercible;
        const opts = theConstructor[COERCIBLE_OPTIONS_SYMBOL];

        const propOpts = opts?.['modelOutput'];
        if (!propOpts) {
            throw new Error('Invalid modelOutput type');
        }
        const final = inputSingle(this.constructor.name, parsed, undefined, {
            type: propOpts.type, desc: propOpts.desc
        });

        this.modelOutput = final;

        return true;
    }

    get modelOutputJSONSchema() {
        const s = this.modelOutputDto?.JSONSchema;
        if (s) {
            return s;
        }

        return { type: s.name.toLowerCase() };
    }

}
