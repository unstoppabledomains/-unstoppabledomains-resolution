import { EthereumNamingService } from './EthereumNamingService';
import { ProxyReaderMap, isNullAddress, ProxyData, VerifiedData } from './types';
import { default as proxyReaderAbi } from './cns/contract/proxyReader';
import { default as resolverInterface } from './cns/contract/resolver';
import ResolutionError, { ResolutionErrorCode } from './errors/resolutionError';
import Contract from './utils/contract';
import standardKeys from './utils/standardKeys';
import { getStartingBlock, isLegacyResolver } from './utils';
import {
  SourceDefinition,
  NamingServiceName,
  ResolutionResponse,
  CryptoRecords,
} from './publicTypes';
import { isValidTwitterSignature } from './utils/TwitterSignatureValidator';
import NamingService from './NamingService';
import NetworkConfig from './config/network-config.json';
import ConfigurationError, { ConfigurationErrorCode } from './errors/configurationError';

export default class Cns extends EthereumNamingService {
  readonly contract: Contract;
  static TwitterVerificationAddress = '0x12cfb13522F13a78b650a8bCbFCf50b7CB899d82';
  static ProxyReaderMap: ProxyReaderMap = getProxyReaderMap();

  constructor(source: SourceDefinition = {}) {
    super(source, NamingServiceName.CNS);
    const network = Number(source.network) || 1;
    const proxyContractAddress  = this.defaultRegistry(network);
    if (!proxyContractAddress) {
      throw new ConfigurationError(ConfigurationErrorCode.UnspecifiedNetwork)
    }
    this.contract = this.buildContract(proxyReaderAbi, proxyContractAddress);
  }

  protected defaultRegistry(network: number): string | undefined {
    return Cns.ProxyReaderMap[network];
  }

  isSupportedDomain(domain: string): boolean {
    return (
      domain === 'crypto' ||
      (domain.indexOf('.') > 0 &&
        /^.{1,}\.(crypto)$/.test(domain) &&
        domain.split('.').every(v => !!v.length))
    );
  }

  async resolver(domain: string): Promise<string> {
   return (await this.getVerifiedData(domain)).resolver;
  }

  async owner(domain: string): Promise<string> {
    return (await this.getVerifiedData(domain)).owner;
  }

  async allRecords(domain: string): Promise<CryptoRecords> {
    const tokenId = this.namehash(domain);
    const resolver = await this.resolver(domain);

    const resolverContract = this.buildContract(resolverInterface, resolver);
    if (isLegacyResolver(resolver)) {
      return await this.getStandardRecords(tokenId);
    }

    return await this.getAllRecords(resolverContract, tokenId);
  }

  async twitter(domain: string): Promise<string> {
    const tokenId = this.namehash(domain);
    const records = [
      standardKeys.validation_twitter_username,
      standardKeys.twitter_username,
    ];
    const data = await this.getVerifiedData(domain, records);
    const { owner, values } = data;
    records.forEach((recordName, i) => {
      return NamingService.ensureRecordPresence(domain, recordName, values && values[i]);
    });
    const [validationSignature, twitterHandle] = values!;
    if (
      !isValidTwitterSignature({
        tokenId,
        owner,
        twitterHandle,
        validationSignature,
      })
    ) {
      throw new ResolutionError(
        ResolutionErrorCode.InvalidTwitterVerification,
        {
          domain,
        },
      );
    }

    return twitterHandle;
  }

  async records(domain: string, keys: string[]): Promise<CryptoRecords> {
    const data = await this.getVerifiedData(domain, keys);
    return this.constructRecords(keys, data.values);
  }

  async resolve(_: string): Promise<ResolutionResponse> {
    throw new Error('This method is unsupported for CNS');
  }

  private async getVerifiedData(domain: string, keys?: string[]): Promise<VerifiedData<ProxyData>> {
    const tokenId = this.namehash(domain);
    const data = await this.get(tokenId, keys);
    if (isNullAddress(data.resolver)) {
      if (isNullAddress(data.owner)) {
        throw new ResolutionError(ResolutionErrorCode.UnregisteredDomain, {domain});
      }
      throw new ResolutionError(ResolutionErrorCode.UnspecifiedResolver, {domain});
    }
    return {owner: data.owner!, resolver: data.resolver!, values: data.values || [] };
  }

  private async getStandardRecords(tokenId: string): Promise<CryptoRecords> {
    const keys = Object.values(standardKeys);
    const values = await this.getMany(tokenId, keys);
    return this.constructRecords(keys, values);
  }

  private async getAllRecords(
    resolverContract: Contract,
    tokenId: string,
  ): Promise<CryptoRecords> {
    const startingBlock = await getStartingBlock(resolverContract, tokenId);
    const logs = await resolverContract.fetchLogs(
      'NewKey',
      tokenId,
      startingBlock,
    );
    const keyTopics = logs.map(event => event.topics[2]);
    // If there are no NewKey events we want to check the standardRecords
    if (keyTopics.length === 0) {
      return await this.getStandardRecords(tokenId);
    }
    const [keys, values] = await this.getManyByHash(tokenId, keyTopics);
    return this.constructRecords(keys, values);
  }

  private async getMany(tokenId: string, keys: string[]): Promise<string[]> {
    const {values} = await this.get(tokenId, keys);
    return values || [];
  }

  private async getManyByHash(tokenId: string, hashes: string[]): Promise<[string[], string[]]> {
    return await this.contract.call('getManyByHash', [hashes, tokenId]) as [string[], string[]];
  }

  private async get(tokenId: string, keys: string[] = []): Promise<ProxyData> {
    const [resolver, owner, values] = await this.contract.call('getData', [
      keys,
      tokenId,
    ]);
    return { resolver, owner, values };
  }  
}

function getProxyReaderMap(): ProxyReaderMap {
  const map: ProxyReaderMap = {};
  for (const id of Object.keys(NetworkConfig.networks)) {
    map[id] = NetworkConfig.networks[id].contracts.ProxyReader.address.toLowerCase();
  }
  return map;
}
