import { MemoryStore } from '../src/store/memory.js';
import { storeContract } from './store-contract.js';

storeContract('MemoryStore', async () => new MemoryStore());
