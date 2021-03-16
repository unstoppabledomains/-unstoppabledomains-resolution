import { BlockhanNetworkUrlMap, CnsSupportedNetwork, ProxyReaderMap } from './types';
import { default as proxyReaderAbi } from './contracts/cns/proxyReader';
import { default as resolverInterface } from './contracts/cns/resolver';
import ResolutionError, { ResolutionErrorCode } from './errors/resolutionError';
import EthereumContract from './contracts/EthereumContract';
import standardKeys from './utils/standardKeys';
import { constructRecords, isNullAddress, EthereumNetworksInverted, EthereumNetworks } from './utils';
import { CnsSource, CnsSupportedNetworks, CryptoRecords, DomainData, hasProvider, NamingServiceName, Provider } from './types/publicTypes';
import { isValidTwitterSignature } from './utils/TwitterSignatureValidator';
import NetworkConfig from './config/network-config.json';
import FetchProvider from './FetchProvider';
import { eip137Childhash, eip137Namehash } from './utils/namehash';
import { NamingService } from './NamingService';
import ConfigurationError, { ConfigurationErrorCode } from './errors/configurationError';
import { FetchError } from 'node-fetch';

/**
 * @internal
 */
export default class Cns extends NamingService {
  static readonly ProxyReaderMap: ProxyReaderMap = getProxyReaderMap();

  static readonly UrlMap: BlockhanNetworkUrlMap = {
    1: 'https://mainnet.infura.io/v3/c4bb906ed6904c42b19c95825fe55f39',
    4: 'https://rinkeby.infura.io/v3/c4bb906ed6904c42b19c95825fe55f39',
  };

  readonly name: NamingServiceName = NamingServiceName.CNS;
  readonly network: number;
  readonly url: string | undefined;
  readonly provider: Provider;
  readonly readerContract: EthereumContract;

  constructor(source?: CnsSource) {
    super();
    if (!source) {
      source = {
        url: Cns.UrlMap[1],
        network: "mainnet",
      };
    }
    if (!source.network || !CnsSupportedNetwork.guard(source.network)) {
      throw new ConfigurationError(ConfigurationErrorCode.UnsupportedNetwork, {
        method: NamingServiceName.CNS,
      });
    }
    this.network = EthereumNetworks[source.network];
    this.url = source['url'] || Cns.UrlMap[this.network];
    this.provider = source['provider'] || new FetchProvider(this.name, this.url!);
    this.readerContract = new EthereumContract(
      proxyReaderAbi,
      source['proxyReaderAddress'] || Cns.ProxyReaderMap[this.network],
      this.provider
    );
  }

  static async getNetworkConfigs(config?: { url: string } | { provider: Provider } ): Promise<{ network: CnsSupportedNetworks, provider: Provider } | undefined> {
    if (!config) {
      return undefined;
    }
    try {
      const provider = hasProvider(config) ? config.provider : new FetchProvider(NamingServiceName.CNS, config.url);
      const networkId = await provider.request({method: "net_version"}) as number;
      const networkName = EthereumNetworksInverted[networkId];
      if (!networkName || !CnsSupportedNetwork.guard(networkName)) {
        throw new ConfigurationError(ConfigurationErrorCode.UnsupportedNetwork, {method: NamingServiceName.CNS});
      }
      return {
        network: networkName,
        provider
      }
    } catch(error) {
      if (error instanceof FetchError) {
        throw new ConfigurationError(ConfigurationErrorCode.IncorrectBlockchainProvider, {method: NamingServiceName.CNS});
      }
      throw error;
    }
  }

  namehash(domain: string): string {
    if (!this.isSupportedDomain(domain)) {
      throw new ResolutionError(ResolutionErrorCode.UnsupportedDomain, {domain});
    }
    return eip137Namehash(domain);
  }

  childhash(parentHash: string, label: string): string {
    return eip137Childhash(parentHash, label);
  }

  serviceName(): NamingServiceName {
    return this.name;
  }

  isSupportedDomain(domain: string): boolean {
    return (
      domain === 'crypto' ||
          (/^.+\.(crypto)$/.test(domain) && // at least one character plus .crypto ending
            domain.split('.').every(v => !!v.length))
    );
  }

  async owner(domain: string): Promise<string> {
    return (await this.getVerifiedData(domain)).owner;
  }

  async resolver(domain: string): Promise<string> {
    return (await this.getVerifiedData(domain)).resolver;
  }

  async record(domain: string, key: string): Promise<string> {
    const returnee = (await this.records(domain, [key]))[key];
    if (!returnee) {
      throw new ResolutionError(ResolutionErrorCode.RecordNotFound, {recordName: key, domain});
    }
    return returnee
  }

  async records(domain: string, keys: string[]): Promise<Record<string, string>> {
    return (await this.getVerifiedData(domain, keys)).records;
  }

  async allRecords(domain: string): Promise<CryptoRecords> {
    const tokenId = this.namehash(domain);
    const resolver = await this.resolver(domain);

    const resolverContract = new EthereumContract(resolverInterface, resolver, this.provider);
    if (this.isLegacyResolver(resolver)) {
      return await this.getStandardRecords(tokenId);
    }

    return await this.getAllRecords(resolverContract, tokenId);
  }

  async twitter(domain: string): Promise<string> {
    const tokenId = this.namehash(domain);
    const keys = [
      standardKeys.validation_twitter_username,
      standardKeys.twitter_username,
    ];
    const data = await this.getVerifiedData(domain, keys);
    const {records} = data;
    const validationSignature = records[standardKeys.validation_twitter_username];
    const twitterHandle = records[standardKeys.twitter_username];
    if (isNullAddress(validationSignature)) {
      throw new ResolutionError(ResolutionErrorCode.RecordNotFound, {domain, recordName: standardKeys.validation_twitter_username})
    }

    if (!twitterHandle) {
      throw new ResolutionError(ResolutionErrorCode.RecordNotFound, {domain, recordName: standardKeys.twitter_username})
    }

    const owner = data.owner;
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

  async reverse(address: string, currencyTicker: string): Promise<string | null> {
    throw new ResolutionError(ResolutionErrorCode.UnsupportedMethod, {
      methodName: 'reverse',
    });
  }

  private async getVerifiedData(domain: string, keys?: string[]): Promise<DomainData> {
    const tokenId = this.namehash(domain);
    const data = await this.get(tokenId, keys);
    if (isNullAddress(data.resolver)) {
      if (isNullAddress(data.owner)) {
        throw new ResolutionError(ResolutionErrorCode.UnregisteredDomain, {domain});
      }
      throw new ResolutionError(ResolutionErrorCode.UnspecifiedResolver, {domain});
    }
    return data;
  }

  private async getStandardRecords(tokenId: string): Promise<CryptoRecords> {
    const keys = Object.values(standardKeys);
    return await this.getMany(tokenId, keys);
  }

  private async getAllRecords(
    resolverContract: EthereumContract,
    tokenId: string,
  ): Promise<CryptoRecords> {
    const startingBlock = await this.getStartingBlock(resolverContract, tokenId);
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
    return await this.getManyByHash(tokenId, keyTopics);
  }

  private async getMany(tokenId: string, keys: string[]): Promise<CryptoRecords> {
    return (await this.get(tokenId, keys)).records;
  }

  private async getManyByHash(tokenId: string, hashes: string[]): Promise<CryptoRecords> {
    const [keys, values] = await this.readerContract.call('getManyByHash', [hashes, tokenId]) as [string[], string[]];
    return constructRecords(keys, values);
  }

  private async get(tokenId: string, keys: string[] = []): Promise<DomainData> {
    const [resolver, owner, values] = await this.readerContract.call('getData', [
      keys,
      tokenId,
    ]);
    return {owner, resolver, records: constructRecords(keys, values)}
  }

  private isLegacyResolver(resolverAddress: string): boolean {
    if (this.isWellKnownLegacyResolver(resolverAddress)) {
      return true;
    }
    if (this.isUpToDateResolver(resolverAddress)) {
      return false;
    }
    return false;
  }

  private isWellKnownLegacyResolver(resolverAddress: string): boolean {
    const legacyAddresses = NetworkConfig?.networks[this.network]?.contracts?.Resolver?.legacyAddresses;
    if (!legacyAddresses || legacyAddresses.length === 0) {
      return false;
    }
    return legacyAddresses.findIndex((address) => {
      return address.toLowerCase() === resolverAddress.toLowerCase()
    }) > -1;
  }

  private isUpToDateResolver(resolverAddress: string): boolean {
    const address = NetworkConfig?.networks[this.network]?.contracts?.Resolver?.address;
    if (!address) {
      return false;
    }
    return address.toLowerCase() === resolverAddress.toLowerCase();
  }

  private async getStartingBlock(
    contract: EthereumContract,
    tokenId: string,
  ): Promise<string> {
    const CRYPTO_RESOLVER_ADVANCED_EVENTS_STARTING_BLOCK = '0x960844';
    const logs = await contract.fetchLogs('ResetRecords', tokenId);
    const lastResetEvent = logs[logs.length - 1];
    return (
      lastResetEvent?.blockNumber ||
      CRYPTO_RESOLVER_ADVANCED_EVENTS_STARTING_BLOCK
    );
  }
}

function getProxyReaderMap(): ProxyReaderMap {
  const map: ProxyReaderMap = {};
  for (const id of Object.keys(NetworkConfig.networks)) {
    map[id] = NetworkConfig.networks[id].contracts.ProxyReader.address.toLowerCase();
  }
  return map;
}
