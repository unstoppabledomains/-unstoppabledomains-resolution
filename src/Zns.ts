import {
  fromBech32Address,
  toBech32Address,
  toChecksumAddress,
} from './utils/znsUtils';
import {isNullAddress, constructRecords} from './utils';
import {Dictionary, ZnsResolution, ZnsSupportedNetwork} from './types';
import {ResolutionError, ResolutionErrorCode} from './errors/resolutionError';
import {
  CryptoRecords,
  Provider,
  ZnsSource,
  NamingServiceName,
  Locations,
  UnsLocation,
  BlockchainType,
  DomainLocation,
} from './types/publicTypes';
import FetchProvider from './FetchProvider';
import {znsChildhash, znsNamehash} from './utils/namehash';
import {NamingService} from './NamingService';
import ConfigurationError, {
  ConfigurationErrorCode,
} from './errors/configurationError';

/**
 * @internal
 */
export default class Zns extends NamingService {
  static readonly UrlMap = {
    1: 'https://api.zilliqa.com',
    333: 'https://dev-api.zilliqa.com',
    111: 'http://localhost:4201',
  };

  static readonly NetworkNameMap = {
    mainnet: 1,
    testnet: 333,
    localnet: 111,
  };

  static readonly RegistryMap = {
    1: 'zil1jcgu2wlx6xejqk9jw3aaankw6lsjzeunx2j0jz',
    333: 'zil1hyj6m5w4atcn7s806s69r0uh5g4t84e8gp6nps',
  };

  readonly network: number;
  readonly name: NamingServiceName = NamingServiceName.ZNS;
  readonly url: string;
  readonly registryAddr: string;
  readonly provider: Provider;

  constructor(
    source: ZnsSource = {
      url: Zns.UrlMap[1],
      network: 'mainnet',
    },
  ) {
    super();
    this.checkNetworkConfig(source);
    this.network = Zns.NetworkNameMap[source.network];
    this.url = source['url'] || Zns.UrlMap[this.network];
    this.provider =
      source['provider'] || new FetchProvider(this.name, this.url!);
    this.registryAddr =
      source['registryAddress'] || Zns.RegistryMap[this.network];
    this.checkRegistryAddress(this.registryAddr);
    if (this.registryAddr.startsWith('0x')) {
      this.registryAddr = toBech32Address(this.registryAddr);
    }
  }

  async owner(domain: string): Promise<string> {
    const recordAddresses = await this.getRecordsAddresses(domain);
    if (!recordAddresses) {
      throw new ResolutionError(ResolutionErrorCode.UnregisteredDomain, {
        domain,
      });
    }
    const [ownerAddress] = recordAddresses;
    if (!ownerAddress) {
      throw new ResolutionError(ResolutionErrorCode.UnregisteredDomain, {
        domain,
      });
    }

    return ownerAddress;
  }

  async resolver(domain: string): Promise<string> {
    const recordsAddresses = await this.getRecordsAddresses(domain);
    if (!recordsAddresses || !recordsAddresses[0]) {
      throw new ResolutionError(ResolutionErrorCode.UnregisteredDomain, {
        domain: domain,
      });
    }

    const [, resolverAddress] = recordsAddresses;
    if (isNullAddress(resolverAddress)) {
      throw new ResolutionError(ResolutionErrorCode.UnspecifiedResolver, {
        domain: domain,
      });
    }

    return resolverAddress;
  }

  namehash(domain: string): string {
    if (!this.checkDomain(domain)) {
      throw new ResolutionError(ResolutionErrorCode.UnsupportedDomain, {
        domain,
      });
    }
    return znsNamehash(domain);
  }

  childhash(parentHash: string, label: string): string {
    return znsChildhash(parentHash, label);
  }

  async isSupportedDomain(domain: string): Promise<boolean> {
    return this.checkDomain(domain);
  }

  async record(domain: string, key: string): Promise<string> {
    const records = await this.records(domain, [key]);
    const record = records[key];
    if (!record) {
      throw new ResolutionError(ResolutionErrorCode.RecordNotFound, {
        domain,
        recordName: key,
      });
    }
    return record;
  }

  async records(domain: string, keys: string[]): Promise<CryptoRecords> {
    const records = await this.allRecords(domain);
    return constructRecords(keys, records);
  }

  async allRecords(domain: string): Promise<CryptoRecords> {
    const resolverAddress = await this.resolver(domain);
    return this.getResolverRecords(resolverAddress);
  }

  async twitter(domain: string): Promise<string> {
    throw new ResolutionError(ResolutionErrorCode.UnsupportedMethod, {
      domain,
      methodName: 'twitter',
    });
  }

  async reverse(
    address: string,
    currencyTicker: string,
  ): Promise<string | null> {
    throw new ResolutionError(ResolutionErrorCode.UnsupportedMethod, {
      methodName: 'reverse',
    });
  }

  async reverseOf(
    address: string,
    location?: UnsLocation,
  ): Promise<string | null> {
    throw new ResolutionError(ResolutionErrorCode.UnsupportedMethod, {
      methodName: 'reverseOf',
    });
  }

  async isRegistered(domain: string): Promise<boolean> {
    const recordAddresses = await this.getRecordsAddresses(domain);
    return Boolean(recordAddresses && recordAddresses[0]);
  }

  async getTokenUri(tokenId: string): Promise<string> {
    throw new ResolutionError(ResolutionErrorCode.UnsupportedMethod, {
      methodName: 'getTokenUri',
    });
  }

  async getDomainFromTokenId(tokenId: string): Promise<string> {
    throw new ResolutionError(ResolutionErrorCode.UnsupportedMethod, {
      methodName: 'getDomainFromTokenId',
    });
  }

  async isAvailable(domain: string): Promise<boolean> {
    return !(await this.isRegistered(domain));
  }

  async registryAddress(domain: string): Promise<string> {
    return this.registryAddr;
  }

  async locations(domains: string[]): Promise<Locations> {
    const recordsAddresses = await Promise.all(
      domains.map((domain) => this.getRecordsAddresses(domain)),
    );
    return domains.reduce((locations, domain, i) => {
      let location: DomainLocation | null = null;
      const domainRecordsAddresses = recordsAddresses[i];
      if (domainRecordsAddresses) {
        const [ownerAddress, resolverAddress] = domainRecordsAddresses;
        location = {
          registryAddress: this.registryAddr,
          resolverAddress,
          networkId: this.network,
          blockchain: BlockchainType.ZIL,
          ownerAddress,
          blockchainProviderUrl: this.url,
        };
      }
      return {
        ...locations,
        [domain]: location,
      };
    }, {} as Locations);
  }

  private async getRecordsAddresses(
    domain: string,
  ): Promise<[string, string] | undefined> {
    if (!this.isSupportedDomain(domain)) {
      throw new ResolutionError(ResolutionErrorCode.UnsupportedDomain, {
        domain,
      });
    }

    const registryRecord = await this.getContractMapValue(
      this.registryAddr,
      'records',
      this.namehash(domain),
    );
    if (!registryRecord) {
      return undefined;
    }
    const [ownerAddress, resolverAddress] = registryRecord.arguments as [
      string,
      string,
    ];
    return [
      ownerAddress.startsWith('0x')
        ? toBech32Address(ownerAddress)
        : ownerAddress,
      resolverAddress,
    ];
  }

  private async getResolverRecords(
    resolverAddress: string,
  ): Promise<ZnsResolution> {
    if (isNullAddress(resolverAddress)) {
      return {};
    }
    const resolver = toChecksumAddress(resolverAddress);
    return ((await this.getContractField(resolver, 'records')) ||
      {}) as Dictionary<string>;
  }

  private async fetchSubState(
    contractAddress: string,
    field: string,
    keys: string[] = [],
  ): Promise<any> {
    const params = [contractAddress.replace('0x', ''), field, keys];
    const method = 'GetSmartContractSubState';
    return this.provider.request({method, params});
  }

  private async getContractField(
    contractAddress: string,
    field: string,
    keys: string[] = [],
  ): Promise<any> {
    const contractAddr = contractAddress.startsWith('zil1')
      ? fromBech32Address(contractAddress)
      : contractAddress;
    const result = (await this.fetchSubState(contractAddr, field, keys)) || {};
    return result[field];
  }

  private async getContractMapValue(
    contractAddress: string,
    field: string,
    key: string,
  ): Promise<any> {
    const record = await this.getContractField(contractAddress, field, [key]);
    return (record && record[key]) || null;
  }

  private checkDomain(domain: String): boolean {
    const tokens = domain.split('.');
    return (
      !!tokens.length &&
      tokens[tokens.length - 1] === 'zil' &&
      tokens.every((v) => !!v.length)
    );
  }

  private checkNetworkConfig(source: ZnsSource): void {
    if (!source.network) {
      throw new ConfigurationError(ConfigurationErrorCode.UnsupportedNetwork, {
        method: NamingServiceName.ZNS,
      });
    }
    if (!ZnsSupportedNetwork.guard(source.network)) {
      this.checkCustomNetworkConfig(source);
    }
  }

  private checkRegistryAddress(address: string): void {
    // Represents both versions of Zilliqa addresses eth-like and bech32 zil-like
    const addressValidator = new RegExp(
      '^0x[a-fA-F0-9]{40}$|^zil1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$',
    );
    if (!addressValidator.test(address)) {
      throw new ConfigurationError(
        ConfigurationErrorCode.InvalidConfigurationField,
        {
          method: this.name,
          field: 'registryAddress',
        },
      );
    }
  }

  private checkCustomNetworkConfig(source: ZnsSource): void {
    if (!source.registryAddress) {
      throw new ConfigurationError(
        ConfigurationErrorCode.CustomNetworkConfigMissing,
        {
          method: NamingServiceName.ZNS,
          config: 'registryAddress',
        },
      );
    }
    if (!source['url'] && !source['provider']) {
      throw new ConfigurationError(
        ConfigurationErrorCode.CustomNetworkConfigMissing,
        {
          method: NamingServiceName.ZNS,
          config: 'url or provider',
        },
      );
    }
  }
}
