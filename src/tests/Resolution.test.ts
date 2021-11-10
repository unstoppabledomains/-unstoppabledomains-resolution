import nock from 'nock';
import Resolution, {
  ResolutionError,
  ResolutionErrorCode,
  UnclaimedDomainResponse,
  UnsLocation,
} from '../index';
import {
  BlockchainType,
  DnsRecordType,
  JsonRpcPayload,
  NamingServiceName,
} from '../types/publicTypes';
import {JsonRpcProvider, InfuraProvider} from '@ethersproject/providers';
import Web3HttpProvider from 'web3-providers-http';
import Web3WsProvider from 'web3-providers-ws';
import Web3V027Provider from 'web3-0.20.7/lib/web3/httpprovider';
import {
  expectResolutionErrorCode,
  expectSpyToBeCalled,
  mockAsyncMethods,
  protocolLink,
  ProviderProtocol,
  caseMock,
  mockAsyncMethod,
  CryptoDomainWithTwitterVerification,
  skipItInLive,
  isLive,
  CryptoDomainWithUsdtMultiChainRecords,
  expectConfigurationErrorCode,
  CryptoDomainWithAllRecords,
  WalletDomainLayerTwoWithAllRecords,
  WalletDomainOnBothLayers,
} from './helpers';
import {RpcProviderTestCases} from './providerMockData';
import fetch, {FetchError} from 'node-fetch';
import Uns from '../Uns';
import Zns from '../Zns';
import Ens from '../Ens';
import FetchProvider from '../FetchProvider';
import {
  ConfigurationErrorCode,
  ConfigurationError,
} from '../errors/configurationError';
import {HTTPProvider} from '@zilliqa-js/core';
import {Eip1993Factories as Eip1193Factories} from '../utils/Eip1993Factories';
import UnsConfig from '../config/uns-config.json';
import {NullAddress} from '../types';
import Networking from '../utils/Networking';

let resolution: Resolution;
let uns: Uns;
let zns: Zns;
let ens: Ens;

beforeEach(() => {
  nock.cleanAll();
  jest.restoreAllMocks();
  resolution = new Resolution({
    sourceConfig: {
      uns: {
        locations: {
          Layer1: {url: protocolLink(), network: 'rinkeby'},
          Layer2: {
            url: protocolLink(ProviderProtocol.http, 'UNSL2'),
            network: 'polygon-mumbai',
          },
        },
      },
      ens: {url: protocolLink(), network: 'rinkeby'},
      zns: {network: 'testnet'},
    },
  });
  uns = resolution.serviceMap[NamingServiceName.UNS] as unknown as Uns;
  ens = resolution.serviceMap[NamingServiceName.ENS] as unknown as Ens;
  zns = resolution.serviceMap[NamingServiceName.ZNS] as unknown as Zns;
});

describe('Resolution', () => {
  describe('.Basic setup', () => {
    it('should work with autonetwork url configuration', async () => {
      const polygonUrl = protocolLink(ProviderProtocol.http, 'UNSL2');
      const rinkebyUrl = protocolLink();
      const goerliUrl = rinkebyUrl.replace('rinkeby', 'goerli');
      // mocking getNetworkConfigs because no access to inner provider.request
      const UnsGetNetworkOriginal = Uns.autoNetwork;
      const EnsGetNetworkOriginal = Ens.autoNetwork;
      if (!isLive()) {
        Uns.autoNetwork = jest.fn().mockReturnValue(
          new Uns({
            locations: {
              Layer1: {
                network: 'rinkeby',
                provider: new FetchProvider(UnsLocation.Layer1, rinkebyUrl),
              },
              Layer2: {
                network: 'polygon-mumbai',
                provider: new FetchProvider(UnsLocation.Layer2, polygonUrl),
              },
            },
          }),
        );
        Ens.autoNetwork = jest.fn().mockReturnValue(
          new Ens({
            network: 'goerli',
            provider: new FetchProvider(NamingServiceName.ENS, goerliUrl),
          }),
        );
      }
      const resolution = await Resolution.autoNetwork({
        uns: {
          locations: {Layer1: {url: rinkebyUrl}, Layer2: {url: polygonUrl}},
        },
        ens: {url: goerliUrl},
      });
      // We need to manually restore the function as jest.restoreAllMocks and simillar works only with spyOn
      Uns.autoNetwork = UnsGetNetworkOriginal;
      Ens.autoNetwork = EnsGetNetworkOriginal;
      expect(
        (resolution.serviceMap[NamingServiceName.UNS] as unknown as Uns).unsl1
          .network,
      ).toBe('rinkeby');
      expect(
        (resolution.serviceMap[NamingServiceName.UNS] as unknown as Uns).unsl2
          .network,
      ).toBe('polygon-mumbai');
      expect(
        (resolution.serviceMap[NamingServiceName.ENS] as unknown as Ens)
          .network,
      ).toBe(5);
    });

    it('should not work with invalid proxyReader configuration #1', async () => {
      const mainnetUrl = protocolLink();
      const customNetwork = 'goerli';
      const polygonUrl = protocolLink(ProviderProtocol.http, 'UNSL2');
      const goerliUrl = mainnetUrl.replace('mainnet', customNetwork);
      await expectConfigurationErrorCode(() => {
        new Uns({
          locations: {
            Layer1: {
              network: customNetwork,
              url: goerliUrl,
              proxyReaderAddress: '0x012312931293',
            },
            Layer2: {
              network: 'polygon-mumbai',
              url: polygonUrl,
              proxyReaderAddress: '0x012312931293',
            },
          },
        });
      }, ConfigurationErrorCode.InvalidConfigurationField);
    });
    it('should not work with invalid proxyReader configuration #2', async () => {
      const mainnetUrl = protocolLink();
      const customNetwork = 'goerli';
      const polygonUrl = protocolLink(ProviderProtocol.http, 'UNSL2');
      const goerliUrl = mainnetUrl.replace('mainnet', customNetwork);
      await expect(() => {
        new Uns({
          locations: {
            Layer1: {
              network: customNetwork,
              url: goerliUrl,
              proxyReaderAddress: '0xe7474D07fD2FA286e7e0aa23cd107F8379025037',
            },
            Layer2: {
              network: 'polygon-mumbai',
              url: polygonUrl,
              proxyReaderAddress: '0x012312931293',
            },
          },
        });
      }).toThrow(
        new ConfigurationError(
          ConfigurationErrorCode.InvalidConfigurationField,
          {
            method: UnsLocation.Layer2,
            field: 'proxyReaderAddress',
          },
        ),
      );
    });

    it('should not work with invalid proxyReader configuration #3', async () => {
      const mainnetUrl = protocolLink();
      const provider = new FetchProvider(NamingServiceName.UNS, mainnetUrl);
      const polygonUrl = protocolLink(ProviderProtocol.http, 'UNSL2');
      const polygonProvider = new FetchProvider(UnsLocation.Layer2, polygonUrl);
      const customNetwork = 'goerli';
      await expectConfigurationErrorCode(() => {
        new Uns({
          locations: {
            Layer1: {
              network: customNetwork,
              provider,
              proxyReaderAddress: '0xe7474D07fD2FA286e7e0aa23cd107F8379025037',
            },
            Layer2: {
              network: 'polygon-mumbai',
              provider: polygonProvider,
              proxyReaderAddress: '0x332a8191905fa8e6eea7350b5799f225b8ed',
            },
          },
        });
      }, ConfigurationErrorCode.InvalidConfigurationField);
    });

    it('should work with proxyReader configuration', async () => {
      const mainnetUrl = protocolLink();
      const polygonUrl = protocolLink(ProviderProtocol.http, 'UNSL2');
      const customNetwork = 'goerli';
      const goerliUrl = mainnetUrl.replace('mainnet', customNetwork);
      const uns = new Uns({
        locations: {
          Layer1: {
            network: customNetwork,
            url: goerliUrl,
            proxyReaderAddress: '0xe7474D07fD2FA286e7e0aa23cd107F8379025037',
          },
          Layer2: {
            network: 'polygon-mumbai',
            url: polygonUrl,
            proxyReaderAddress: '0x332a8191905fa8e6eea7350b5799f225b8ed30a9',
          },
        },
      });
      expect(uns).toBeDefined();
    });

    it('should work with custom network configuration with provider', async () => {
      const mainnetUrl = protocolLink();
      const provider = new FetchProvider(NamingServiceName.UNS, mainnetUrl);
      const polygonUrl = protocolLink(ProviderProtocol.http, 'UNSL2');
      const polygonProvider = new FetchProvider(UnsLocation.Layer2, polygonUrl);
      const customNetwork = 'goerli';
      const uns = new Uns({
        locations: {
          Layer1: {
            network: customNetwork,
            provider,
            proxyReaderAddress: '0xe7447Fdd52FA286e7e0aa23cd107F83790250897',
          },
          Layer2: {
            network: 'polygon-mumbai',
            provider: polygonProvider,
            proxyReaderAddress: '0x332a8191905fa8e6eea7350b5799f225b8ed30a9',
          },
        },
      });
      expect(uns).toBeDefined();
    });

    it('should work with autonetwork provider configuration', async () => {
      const provider = new FetchProvider(
        'UDAPI',
        protocolLink().replace('rinkeby', 'mainnet'),
      );
      const polygonUrl = protocolLink(ProviderProtocol.http, 'UNSL2');
      const polygonProvider = new FetchProvider(UnsLocation.Layer2, polygonUrl);
      const spy = mockAsyncMethod(provider, 'request', '1');
      const spyTwo = mockAsyncMethod(polygonProvider, 'request', '80001');
      const resolution = await Resolution.autoNetwork({
        uns: {
          locations: {Layer1: {provider}, Layer2: {provider: polygonProvider}},
        },
        ens: {provider},
      });
      expect(spy).toBeCalledTimes(2);
      expect(spyTwo).toBeCalledTimes(1);
      expect(
        (resolution.serviceMap[NamingServiceName.UNS] as unknown as Uns).unsl1
          .network,
      ).toBe('mainnet');
      expect(
        (resolution.serviceMap[NamingServiceName.UNS] as unknown as Uns).unsl2
          .network,
      ).toBe('polygon-mumbai');
      expect(
        (resolution.serviceMap[NamingServiceName.ENS] as unknown as Ens)
          .network,
      ).toBe(1);
    });

    it('should fail because provided url failled net_version call', async () => {
      const mockedProvider = new FetchProvider(
        NamingServiceName.UNS,
        'https://google.com',
      );
      const providerSpy = mockAsyncMethod(
        mockedProvider,
        'request',
        new ResolutionError(ResolutionErrorCode.ServiceProviderError, {
          providerMessage:
            'Request to https://google.com failed with response status 405',
        }),
      );
      const factorySpy = mockAsyncMethod(
        FetchProvider,
        'factory',
        () => mockedProvider,
      );
      try {
        await Resolution.autoNetwork({
          uns: {
            locations: {
              Layer1: {url: 'https://google.com'},
              Layer2: {url: 'https://google.com'},
            },
          },
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ResolutionError);
        expect(error.message).toBe(
          '< Request to https://google.com failed with response status 405 >',
        );
      }
      expectSpyToBeCalled([factorySpy, providerSpy]);
    });

    it('should fail because provided provider failed to make a net_version call', async () => {
      const mockedProvider = new FetchProvider(
        NamingServiceName.ENS,
        'http://unstoppabledomains.com',
      );
      const providerSpy = mockAsyncMethod(
        mockedProvider,
        'request',
        new FetchError(
          'invalid json response body at https://unstoppabledomains.com/ reason: Unexpected token < in JSON at position 0',
          'invalid_json',
        ),
      );
      try {
        await Resolution.autoNetwork({
          ens: {provider: mockedProvider},
        });
      } catch (error) {
        expect(error).toBeInstanceOf(FetchError);
        expect(error.message).toBe(
          'invalid json response body at https://unstoppabledomains.com/ reason: Unexpected token < in JSON at position 0',
        );
      }
      expect(providerSpy).toBeCalled();
    });

    it('should fail because of unsupported test network for uns', async () => {
      const blockchainUrl = protocolLink().replace('rinkeby', 'ropsten');
      const polygonUrl = protocolLink(ProviderProtocol.http, 'UNSL2');
      const mockedProvider = new FetchProvider(
        NamingServiceName.UNS,
        blockchainUrl,
      );
      mockAsyncMethod(mockedProvider, 'request', () => '3');
      mockAsyncMethod(FetchProvider, 'factory', () => mockedProvider);

      await expectConfigurationErrorCode(
        Resolution.autoNetwork({
          uns: {
            locations: {
              Layer1: {url: blockchainUrl},
              Layer2: {url: polygonUrl},
            },
          },
        }),
        ConfigurationErrorCode.UnsupportedNetwork,
      );
    });

    skipItInLive('should fail in test development', async () => {
      try {
        await fetch('https://pokeres.bastionbot.org/images/pokemon/10.png');
      } catch (err) {
        // nock should prevent all outgoing traffic
        expect(err).toBeInstanceOf(FetchError);
        return;
      }
      throw new Error('nock is not configured correctly!');
    });

    it('should get a valid resolution instance', async () => {
      const resolution = Resolution.infura('api-key', {
        uns: {
          locations: {
            Layer1: {network: 'rinkeby'},
            Layer2: {network: 'polygon-mumbai'},
          },
        },
        ens: {network: 'rinkeby'},
      });
      uns = resolution.serviceMap[NamingServiceName.UNS] as unknown as Uns;
      ens = resolution.serviceMap[NamingServiceName.ENS] as unknown as Ens;
      expect(uns.unsl1.url).toBe(`https://rinkeby.infura.io/v3/api-key`);
      expect(uns.unsl2.url).toBe(`https://polygon-mumbai.infura.io/v3/api-key`);
      expect(ens.url).toBe(`https://rinkeby.infura.io/v3/api-key`);
    });

    it('should throw on unspecified network', async () => {
      expect(() => Resolution.fromResolutionProvider({})).toThrowError(
        '< Must specify network for uns, ens, or zns >',
      );
    });

    it('should create resolution instance from Zilliqa provider', async () => {
      const zilliqaProvider = new HTTPProvider('https://api.zilliqa.com');
      const provider = Eip1193Factories.fromZilliqaProvider(zilliqaProvider);
      const resolutionFromZilliqaProvider =
        Resolution.fromZilliqaProvider(provider);
      const resolution = new Resolution({
        sourceConfig: {
          zns: {url: 'https://api.zilliqa.com', network: 'mainnet'},
        },
      });
      expect(
        (
          resolutionFromZilliqaProvider.serviceMap[
            NamingServiceName.ZNS
          ] as unknown as Zns
        ).url,
      ).toEqual(
        (resolution.serviceMap[NamingServiceName.ZNS] as unknown as Zns).url,
      );
      expect(
        (
          resolutionFromZilliqaProvider.serviceMap[
            NamingServiceName.ZNS
          ] as unknown as Zns
        ).network,
      ).toEqual(
        (resolution.serviceMap[NamingServiceName.ZNS] as unknown as Zns)
          .network,
      );
      expect(
        (
          resolutionFromZilliqaProvider.serviceMap[
            NamingServiceName.ZNS
          ] as unknown as Zns
        ).registryAddr,
      ).toEqual(
        (resolution.serviceMap[NamingServiceName.ZNS] as unknown as Zns)
          .registryAddr,
      );
    });

    it('should retrieve record using resolution instance created from Zilliqa provider', async () => {
      const zilliqaProvider = new HTTPProvider('https://api.zilliqa.com');
      const provider = Eip1193Factories.fromZilliqaProvider(zilliqaProvider);
      const resolution = Resolution.fromZilliqaProvider(provider);
      zns = resolution.serviceMap[NamingServiceName.ZNS] as unknown as Zns;
      const spies = mockAsyncMethods(zns, {
        allRecords: {
          'crypto.ETH.address': '0x45b31e01AA6f42F0549aD482BE81635ED3149abb',
        },
      });
      const ethAddress = await resolution.addr('brad.zil', 'ETH');
      expectSpyToBeCalled(spies);
      expect(ethAddress).toBe('0x45b31e01AA6f42F0549aD482BE81635ED3149abb');
    });

    it('provides empty response constant', async () => {
      const response = UnclaimedDomainResponse;
      expect(response.addresses).toEqual({});
      expect(response.meta.owner).toEqual(null);
    });

    describe('.ServiceName', () => {
      it('checks ens service name', () => {
        const resolution = new Resolution();
        const serviceName = resolution.serviceName('domain.eth');
        expect(serviceName).toBe('ENS');
      });

      it('should resolve gundb chat id', async () => {
        const eyes = mockAsyncMethods(uns, {
          get: {
            resolver: '0x878bC2f3f717766ab69C0A5f9A6144931E61AEd3',
            records: {
              ['gundb.username.value']:
                '0x47992daf742acc24082842752fdc9c875c87c56864fee59d8b779a91933b159e48961566eec6bd6ce3ea2441c6cb4f112d0eb8e8855cc9cf7647f0d9c82f00831c',
            },
          },
        });
        const gundb = await resolution.chatId('homecakes.crypto');
        expectSpyToBeCalled(eyes);
        expect(gundb).toBe(
          '0x47992daf742acc24082842752fdc9c875c87c56864fee59d8b779a91933b159e48961566eec6bd6ce3ea2441c6cb4f112d0eb8e8855cc9cf7647f0d9c82f00831c',
        );
      });

      describe('.ipfsHash', () => {
        skipItInLive(
          'should prioritize new keys over depricated ones',
          async () => {
            const spies = mockAsyncMethods(uns, {
              get: {
                resolver: '0xA1cAc442Be6673C49f8E74FFC7c4fD746f3cBD0D',
                records: {
                  ['dweb.ipfs.hash']: 'new record Ipfs hash',
                  ['ipfs.html.value']: 'old record Ipfs hash',
                },
              },
            });
            const hash = await resolution.ipfsHash(CryptoDomainWithAllRecords);
            expectSpyToBeCalled(spies);
            expect(hash).toBe('new record Ipfs hash');
          },
        );

        skipItInLive(
          'should prioritize browser record key over ipfs.redirect_url one',
          async () => {
            const spies = mockAsyncMethods(uns, {
              get: {
                resolver: '0xA1cAc442Be6673C49f8E74FFC7c4fD746f3cBD0D',
                records: {
                  ['browser.redirect_url']: 'new record redirect url',
                  ['ipfs.redirect_domain.value']: 'old record redirect url',
                },
              },
            });
            const redirectUrl = await resolution.httpUrl(
              CryptoDomainWithAllRecords,
            );
            expectSpyToBeCalled(spies);
            expect(redirectUrl).toBe('new record redirect url');
          },
        );
      });

      describe('serviceName', () => {
        it('checks ens service name', () => {
          const resolution = new Resolution();
          const serviceName = resolution.serviceName('domain.eth');
          expect(serviceName).toBe('ENS');
        });

        it('checks zns service name', () => {
          const resolution = new Resolution();
          const serviceName = resolution.serviceName('domain.zil');
          expect(serviceName).toBe('ZNS');
        });

        it('checks uns service name', () => {
          const resolution = new Resolution();
          const serviceName = resolution.serviceName('domain.crypto');
          expect(serviceName).toBe('UNS');
        });
        it('checks uns service name', () => {
          const resolution = new Resolution();
          const serviceName = resolution.serviceName('domain.wallet');
          expect(serviceName).toBe('UNS');
        });
        it('checks uns service name', () => {
          const resolution = new Resolution();
          const serviceName = resolution.serviceName('domain.coin');
          expect(serviceName).toBe('UNS');
        });
        it('checks uns service name', () => {
          const resolution = new Resolution();
          const serviceName = resolution.serviceName('domain.bitcoin');
          expect(serviceName).toBe('UNS');
        });
        it('checks uns service name', () => {
          const resolution = new Resolution();
          const serviceName = resolution.serviceName('domain.x');
          expect(serviceName).toBe('UNS');
        });
      });
    });

    describe('.Errors', () => {
      it('checks Resolution#addr error #1', async () => {
        const resolution = new Resolution();
        zns = resolution.serviceMap[NamingServiceName.ZNS] as unknown as Zns;
        const spy = mockAsyncMethods(zns, {
          getRecordsAddresses: undefined,
        });
        await expectResolutionErrorCode(
          resolution.addr('sdncdoncvdinvcsdncs.zil', 'ZIL'),
          ResolutionErrorCode.UnregisteredDomain,
        );
        expectSpyToBeCalled(spy);
      });
      it('checks Resolution#addr error #2', async () => {
        const resolution = new Resolution({
          sourceConfig: {
            uns: {
              locations: {
                Layer1: {
                  url: protocolLink(ProviderProtocol.http, 'UNSL1'),
                  network: 'rinkeby',
                },
                Layer2: {
                  url: protocolLink(ProviderProtocol.http, 'UNSL2'),
                  network: 'polygon-mumbai',
                },
              },
            },
          },
        });
        uns = resolution.serviceMap[NamingServiceName.UNS] as unknown as Uns;
        const spy = mockAsyncMethods(uns, {
          get: {},
        });
        await expectResolutionErrorCode(
          resolution.addr('sdncdoncvdinvcsdncs.crypto', 'ETH'),
          ResolutionErrorCode.UnregisteredDomain,
        );
        expectSpyToBeCalled(spy);
      });

      it('checks error for email on ryan-testing.zil', async () => {
        const spies = mockAsyncMethods(zns, {
          allRecords: {
            'crypto.ETH.address': '0xc101679df8e2d6092da6d7ca9bced5bfeeb5abd8',
            'crypto.ZIL.address': 'zil1k78e8zkh79lc47mrpcwqyhdrdkz7ptumk7ud90',
          },
        });
        await expectResolutionErrorCode(
          resolution.email('ryan-testing.zil'),
          ResolutionErrorCode.RecordNotFound,
        );
        expectSpyToBeCalled(spies);
      });

      describe('.Namehash errors', () => {
        it('should be invalid domain', async () => {
          const unsInvalidDomain = 'hello..crypto';
          const ensInvalidDomain = 'hello..eth';
          const znsInvalidDomain = 'hello..zil';
          await expectResolutionErrorCode(
            () => resolution.namehash(unsInvalidDomain),
            ResolutionErrorCode.UnsupportedDomain,
          );
          await expectResolutionErrorCode(
            () => resolution.namehash(ensInvalidDomain),
            ResolutionErrorCode.UnsupportedDomain,
          );
          await expectResolutionErrorCode(
            () => resolution.namehash(znsInvalidDomain),
            ResolutionErrorCode.UnsupportedDomain,
          );
        });
      });
    });

    describe('.Records', () => {
      describe('.DNS', () => {
        skipItInLive('getting dns get', async () => {
          const spies = mockAsyncMethods(uns, {
            get: {
              resolver: '0xBD5F5ec7ed5f19b53726344540296C02584A5237',
              records: {
                'dns.ttl': '128',
                'dns.A': '["10.0.0.1","10.0.0.2"]',
                'dns.A.ttl': '90',
                'dns.AAAA': '["10.0.0.120"]',
              },
            },
          });
          const dnsRecords = await resolution.dns('someTestDomain.crypto', [
            DnsRecordType.A,
            DnsRecordType.AAAA,
          ]);
          expectSpyToBeCalled(spies);
          expect(dnsRecords).toStrictEqual([
            {TTL: 90, data: '10.0.0.1', type: 'A'},
            {TTL: 90, data: '10.0.0.2', type: 'A'},
            {TTL: 128, data: '10.0.0.120', type: 'AAAA'},
          ]);
        });

        skipItInLive('should work with others records', async () => {
          const spies = mockAsyncMethods(uns, {
            get: {
              resolver: '0xBD5F5ec7ed5f19b53726344540296C02584A5237',
              records: {
                'dns.ttl': '128',
                'dns.A': '["10.0.0.1","10.0.0.2"]',
                'dns.A.ttl': '90',
                'dns.AAAA': '["10.0.0.120"]',
                ['crypto.ETH.address']:
                  '0x45b31e01AA6f42F0549aD482BE81635ED3149abb',
                ['crypto.ADA.address']:
                  '0x45b31e01AA6f42F0549aD482BE81635ED3149abb',
                ['crypto.ARK.address']:
                  '0x45b31e01AA6f42F0549aD482BE81635ED3149abb',
              },
            },
          });
          const dnsRecords = await resolution.dns('someTestDomain.crypto', [
            DnsRecordType.A,
            DnsRecordType.AAAA,
          ]);
          expectSpyToBeCalled(spies);
          expect(dnsRecords).toStrictEqual([
            {TTL: 90, data: '10.0.0.1', type: 'A'},
            {TTL: 90, data: '10.0.0.2', type: 'A'},
            {TTL: 128, data: '10.0.0.120', type: 'AAAA'},
          ]);
        });
      });

      describe('.Metadata', () => {
        it('checks return of email for testing.zil', async () => {
          const spies = mockAsyncMethods(zns, {
            allRecords: {
              'ipfs.html.hash':
                'QmefehFs5n8yQcGCVJnBMY3Hr6aMRHtsoniAhsM1KsHMSe',
              'ipfs.html.value':
                'QmVaAtQbi3EtsfpKoLzALm6vXphdi2KjMgxEDKeGg6wHu',
              'ipfs.redirect_domain.value': 'www.unstoppabledomains.com',
              'whois.email.value': 'derainberk@gmail.com',
              'whois.for_sale.value': 'true',
            },
          });
          const email = await resolution.email('testing.zil');
          expectSpyToBeCalled(spies);
          expect(email).toBe('derainberk@gmail.com');
        });
      });

      describe('.Crypto', () => {
        it(`domains "brad.crypto" and "Brad.crypto" should return the same results`, async () => {
          const eyes = mockAsyncMethods(uns, {
            get: {
              resolver: '0xBD5F5ec7ed5f19b53726344540296C02584A5237',
              records: {
                ['crypto.ETH.address']:
                  '0x45b31e01AA6f42F0549aD482BE81635ED3149abb',
              },
            },
          });
          const capital = await resolution.addr('Brad.crypto', 'eth');
          const lower = await resolution.addr('brad.crypto', 'eth');
          expectSpyToBeCalled(eyes, 2);
          expect(capital).toStrictEqual(lower);
        });
        describe('.multichain', () => {
          it('should work with usdt on different erc20', async () => {
            const erc20Spy = mockAsyncMethod(uns, 'get', {
              resolver: '0x95AE1515367aa64C462c71e87157771165B1287A',
              owner: '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
              records: {
                ['crypto.USDT.version.ERC20.address']:
                  '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
              },
            });
            const erc20 = await resolution.multiChainAddr(
              CryptoDomainWithUsdtMultiChainRecords,
              'usdt',
              'erc20',
            );
            expect(erc20).toBe('0xe7474D07fD2FA286e7e0aa23cd107F8379085037');
            expect(erc20Spy).toBeCalled();
          });

          it('should work with usdt tron chain', async () => {
            const tronSpy = mockAsyncMethod(uns, 'get', {
              resolver: '0x95AE1515367aa64C462c71e87157771165B1287A',
              owner: '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
              records: {
                ['crypto.USDT.version.TRON.address']:
                  'TNemhXhpX7MwzZJa3oXvfCjo5pEeXrfN2h',
              },
            });
            const tron = await resolution.multiChainAddr(
              CryptoDomainWithUsdtMultiChainRecords,
              'usdt',
              'tron',
            );
            expect(tron).toBe('TNemhXhpX7MwzZJa3oXvfCjo5pEeXrfN2h');
            expect(tronSpy).toBeCalled();
          });

          it('should work with usdt omni chain', async () => {
            const omniSpy = mockAsyncMethod(uns, 'get', {
              resolver: '0x95AE1515367aa64C462c71e87157771165B1287A',
              owner: '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
              records: {
                ['crypto.USDT.version.OMNI.address']:
                  '19o6LvAdCPkjLi83VsjrCsmvQZUirT4KXJ',
              },
            });
            const omni = await resolution.multiChainAddr(
              CryptoDomainWithUsdtMultiChainRecords,
              'usdt',
              'omni',
            );
            expect(omni).toBe('19o6LvAdCPkjLi83VsjrCsmvQZUirT4KXJ');
            expect(omniSpy).toBeCalled();
          });

          it('should work with usdt eos chain', async () => {
            const eosSpy = mockAsyncMethod(uns, 'get', {
              resolver: '0x95AE1515367aa64C462c71e87157771165B1287A',
              owner: '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
              records: {
                ['crypto.USDT.version.EOS.address']: 'letsminesome',
              },
            });
            const eos = await resolution.multiChainAddr(
              CryptoDomainWithUsdtMultiChainRecords,
              'usdt',
              'eos',
            );
            expect(eosSpy).toBeCalled();
            expect(eos).toBe('letsminesome');
          });
        });
      });

      describe('.Providers', () => {
        it('should work with web3HttpProvider', async () => {
          // web3-providers-http has problems with type definitions
          // We still prefer everything to be statically typed on our end for better mocking
          const provider = new (Web3HttpProvider as any)(
            protocolLink(),
          ) as Web3HttpProvider.HttpProvider;
          const polygonProvider = new (Web3HttpProvider as any)(
            protocolLink(ProviderProtocol.http, 'UNSL2'),
          ) as Web3HttpProvider.HttpProvider;
          // mock the send function with different implementations (each should call callback right away with different answers)
          const eye = mockAsyncMethod(
            provider,
            'send',
            (payload: JsonRpcPayload, callback) => {
              const result = caseMock(
                payload.params?.[0],
                RpcProviderTestCases,
              );
              callback &&
                callback(null, {
                  jsonrpc: '2.0',
                  id: 1,
                  result,
                });
            },
          );
          const resolution = Resolution.fromWeb3Version1Provider({
            uns: {
              locations: {
                Layer1: {network: 'rinkeby', provider},
                Layer2: {network: 'polygon-mumbai', provider: polygonProvider},
              },
            },
          });
          const uns = resolution.serviceMap['UNS'] as unknown as Uns;
          mockAsyncMethod(uns.unsl2.readerContract, 'call', (params) =>
            Promise.resolve([NullAddress, NullAddress, {}]),
          );
          const ethAddress = await resolution.addr('brad.crypto', 'ETH');

          // expect each mock to be called at least once.
          expectSpyToBeCalled([eye]);
          expect(ethAddress).toBe('0x8aaD44321A86b170879d7A244c1e8d360c99DdA8');
        });

        it('should work with webSocketProvider', async () => {
          // web3-providers-ws has problems with type definitions
          // We still prefer everything to be statically typed on our end for better mocking
          const provider = new (Web3WsProvider as any)(
            protocolLink(ProviderProtocol.wss),
          ) as Web3WsProvider.WebsocketProvider;
          const polygonProvider = new (Web3WsProvider as any)(
            protocolLink(ProviderProtocol.wss, 'UNSL2'),
          ) as Web3WsProvider.WebsocketProvider;
          const eye = mockAsyncMethod(provider, 'send', (payload, callback) => {
            const result = caseMock(payload.params?.[0], RpcProviderTestCases);
            callback(null, {
              jsonrpc: '2.0',
              id: 1,
              result,
            });
          });

          const resolution = Resolution.fromWeb3Version1Provider({
            uns: {
              locations: {
                Layer1: {network: 'rinkeby', provider},
                Layer2: {network: 'polygon-mumbai', provider: polygonProvider},
              },
            },
          });
          const uns = resolution.serviceMap['UNS'] as unknown as Uns;
          mockAsyncMethod(uns.unsl2.readerContract, 'call', (params) =>
            Promise.resolve([NullAddress, NullAddress, {}]),
          );
          const ethAddress = await resolution.addr('brad.crypto', 'ETH');
          provider.disconnect(1000, 'end of test');
          expectSpyToBeCalled([eye]);
          expect(ethAddress).toBe('0x8aaD44321A86b170879d7A244c1e8d360c99DdA8');
        });

        it('should work for ethers jsonrpc provider', async () => {
          const provider = new JsonRpcProvider(
            protocolLink(ProviderProtocol.http),
            'rinkeby',
          );
          const polygonProvider = new JsonRpcProvider(
            protocolLink(ProviderProtocol.http, 'UNSL2'),
            'maticmum',
          );
          const resolution = Resolution.fromEthersProvider({
            uns: {
              locations: {
                Layer1: {network: 'rinkeby', provider},
                Layer2: {network: 'polygon-mumbai', provider: polygonProvider},
              },
            },
          });
          const uns = resolution.serviceMap['UNS'] as unknown as Uns;
          mockAsyncMethod(uns.unsl2.readerContract, 'call', (params) =>
            Promise.resolve([NullAddress, NullAddress, {}]),
          );
          const eye = mockAsyncMethod(provider, 'call', (params) =>
            Promise.resolve(caseMock(params, RpcProviderTestCases)),
          );
          const ethAddress = await resolution.addr('brad.crypto', 'ETH');
          expectSpyToBeCalled([eye]);
          expect(ethAddress).toBe('0x8aaD44321A86b170879d7A244c1e8d360c99DdA8');
        });

        it('should work with ethers default provider', async () => {
          const provider = new InfuraProvider(
            'rinkeby',
            '213fff28936343858ca9c5115eff1419',
          );
          const polygonProvider = new InfuraProvider(
            'maticmum',
            'c4bb906ed6904c42b19c95825fe55f39',
          );

          const eye = mockAsyncMethod(provider, 'call', (params) =>
            Promise.resolve(caseMock(params, RpcProviderTestCases)),
          );
          const resolution = Resolution.fromEthersProvider({
            uns: {
              locations: {
                Layer1: {network: 'rinkeby', provider},
                Layer2: {network: 'polygon-mumbai', provider: polygonProvider},
              },
            },
          });
          const uns = resolution.serviceMap['UNS'] as unknown as Uns;
          mockAsyncMethod(uns.unsl2.readerContract, 'call', (params) =>
            Promise.resolve([NullAddress, NullAddress, {}]),
          );
          const ethAddress = await resolution.addr('brad.crypto', 'eth');
          expectSpyToBeCalled([eye]);
          expect(ethAddress).toBe('0x8aaD44321A86b170879d7A244c1e8d360c99DdA8');
        });

        it('should work with web3@0.20.7 provider', async () => {
          const provider = new Web3V027Provider(
            protocolLink(ProviderProtocol.http),
            5000,
            null,
            null,
            null,
          );
          const polygonProvider = new Web3V027Provider(
            protocolLink(ProviderProtocol.http, 'UNSL2'),
            5000,
            null,
            null,
            null,
          );
          const eye = mockAsyncMethod(
            provider,
            'sendAsync',
            (payload: JsonRpcPayload, callback: any) => {
              const result = caseMock(
                payload.params?.[0],
                RpcProviderTestCases,
              );
              callback(undefined, {
                jsonrpc: '2.0',
                id: 1,
                result,
              });
            },
          );
          const resolution = Resolution.fromWeb3Version0Provider({
            uns: {
              locations: {
                Layer1: {network: 'rinkeby', provider},
                Layer2: {network: 'polygon-mumbai', provider: polygonProvider},
              },
            },
          });
          const uns = resolution.serviceMap['UNS'] as unknown as Uns;
          mockAsyncMethod(uns.unsl2.readerContract, 'call', (params) =>
            Promise.resolve([NullAddress, NullAddress, {}]),
          );
          const ethAddress = await resolution.addr('brad.crypto', 'eth');
          expectSpyToBeCalled([eye]);
          expect(ethAddress).toBe('0x8aaD44321A86b170879d7A244c1e8d360c99DdA8');
        });

        describe('.All-get', () => {
          it('should return allNonEmptyRecords', async () => {
            const records = {
              'crypto.ADA.address':
                'DdzFFzCqrhssjmxkChyAHE9MdHJkEc4zsZe7jgum6RtGzKLkUanN1kPZ1ipVPBLwVq2TWrhmPsAvArcr47Pp1VNKmZTh6jv8ctAFVCkj',
              'crypto.BCH.address':
                'qzx048ez005q4yhphqu2pylpfc3hy88zzu4lu6q9j8',
              'crypto.BTC.address': '1MUFCFhhuApRqfbqNby6Jvvp6gbYx6yWhR',
              'crypto.ETH.address':
                '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
              'crypto.LTC.address':
                'ltc1qj03wgu07dqytxz4r9arc4taz2u7mzuz38xpuu4',
              'crypto.USDC.address':
                '0x666574cAdedEB4a0f282fF0C2B3588617E29e6A0',
              'crypto.USDT.version.EOS.address': 'letsminesome',
              'crypto.USDT.version.ERC20.address':
                '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
              'crypto.USDT.version.OMNI.address':
                '19o6LvAdCPkjLi83VsjrCsmvQZUirT4KXJ',
              'crypto.USDT.version.TRON.address':
                'TNemhXhpX7MwzZJa3oXvfCjo5pEeXrfN2h',
              'crypto.XRP.address': 'rMXToC1316oNyqwgQpWgSrzMUU9R6UDizW',
              'crypto.ZIL.address':
                'zil1xftz4cd425mer6jxmtl29l28xr0zu8s5hnp9he',
              'dns.A': '["10.0.0.1","10.0.0.3"]',
              'dns.A.ttl': '98',
              'dns.AAAA': '[]',
              'dns.ttl': '128',
              'ipfs.html.value':
                'QmQ38zzQHVfqMoLWq2VeiMLHHYki9XktzXxLYTWXt8cydu',
              'ipfs.redirect_domain.value': 'google.com',
              'whois.email.value': 'johnny@unstoppabledomains.com',
            };
            const unsl1 = uns.unsl1;
            const unsl2 = uns.unsl2;
            mockAsyncMethods(unsl1, {
              get: {
                owner: '0x878bC2f3f717766ab69C0A5f9A6144931E61AEd3',
                resolver: '0x878bC2f3f717766ab69C0A5f9A6144931E61AEd3',
                records: records,
                location: UnsLocation.Layer1,
              },
            });
            mockAsyncMethods(unsl2, {
              get: {
                owner: NullAddress,
                resolver: NullAddress,
                records: {},
                location: UnsLocation.Layer2,
              },
            });
            mockAsyncMethod(Networking, 'fetch', {
              ok: true,
              json: () => ({
                name: CryptoDomainWithAllRecords,
                properties: {records},
              }),
            });
            const endpoint =
              'https://metadata.staging.unstoppabledomains.com/metadata/';

            mockAsyncMethod(uns, 'getTokenUri', endpoint);
            const result = await resolution.allNonEmptyRecords(
              CryptoDomainWithAllRecords,
            );
            expect(result).toEqual(records);
          });

          it('should get standard keys from legacy resolver', async () => {
            // There are no legacy providers on testnet
            const provider = new InfuraProvider(
              'mainnet',
              'c4bb906ed6904c42b19c95825fe55f39',
            );
            const eye = mockAsyncMethod(provider, 'call', (params) =>
              Promise.resolve(caseMock(params, RpcProviderTestCases)),
            );
            const polygonProvider = new InfuraProvider(
              'maticmum',
              'c4bb906ed6904c42b19c95825fe55f39',
            );
            const resolution = Resolution.fromEthersProvider({
              uns: {
                locations: {
                  Layer1: {network: 'mainnet', provider},
                  Layer2: {
                    network: 'polygon-mumbai',
                    provider: polygonProvider,
                  },
                },
              },
            });
            const uns = resolution.serviceMap['UNS'] as unknown as Uns;

            mockAsyncMethod(uns.unsl2, 'get', (params) =>
              Promise.resolve([NullAddress, NullAddress, {}]),
            );
            mockAsyncMethod(Networking, 'fetch', {
              ok: true,
              json: () => ({
                name: 'monmouthcounty.crypto',
                properties: {records: {}},
              }),
            });
            const endpoint =
              'https://metadata.staging.unstoppabledomains.com/metadata/';

            mockAsyncMethod(uns, 'getTokenUri', endpoint);
            const resp = await resolution.allRecords('monmouthcounty.crypto');

            expectSpyToBeCalled([eye], 1);
            expect(resp).toMatchObject({
              'crypto.BTC.address': '3NwuV8nVT2VKbtCs8evChdiW6kHTHcVpdn',
              'crypto.ETH.address':
                '0x1C42088b82f6Fa5fB883A14240C4E066dDFf1517',
              'crypto.LTC.address': 'MTnTNwKikiMi97Teq8XQRabL9SZ4HjnKNB',
              'crypto.ADA.address':
                'DdzFFzCqrhsfc3MQvjsLr9BHkaFYeE7BotyTATdETRoSPj6QPiotK4xpcFZk66KVmtr87tvUFTcbTHZRkcdbMR5Ss6jCfzCVtFRMB7WE',
              'ipfs.html.value':
                'QmYqX8D8SkaF5YcpaWMyi5xM43UEteFiSNKYsjLcdvCWud',
              'ipfs.redirect_domain.value':
                'https://abbfe6z95qov3d40hf6j30g7auo7afhp.mypinata.cloud/ipfs/QmYqX8D8SkaF5YcpaWMyi5xM43UEteFiSNKYsjLcdvCWud',
            });
          });
        });

        it('should get all records using custom networks', async () => {
          const resolution = new Resolution({
            sourceConfig: {
              uns: {
                locations: {
                  Layer1: {
                    network: 'custom',
                    proxyReaderAddress:
                      '0xfee4d4f0adff8d84c12170306507554bc7045878',
                    url: 'https://mainnet.infura.io/v3/c4bb906ed6904c42b19c95825fe55f39',
                  },
                  Layer2: {
                    network: 'custom',
                    proxyReaderAddress:
                      '0x332a8191905fa8e6eea7350b5799f225b8ed30a9',
                    url: 'https://polygon-mumbai.infura.io/v3/c4bb906ed6904c42b19c95825fe55f39',
                  },
                },
              },
              zns: {
                network: 'custom',
                registryAddress: 'zil1jcgu2wlx6xejqk9jw3aaankw6lsjzeunx2j0jz',
                url: 'https://api.zilliqa.com',
              },
            },
          });
          const uns = resolution.serviceMap['UNS'] as unknown as Uns;
          const zns = resolution.serviceMap['ZNS'] as unknown as Zns;
          const unsl1 = uns.unsl1;
          const unsl2 = uns.unsl2;
          const unsL1GetMock = mockAsyncMethods(unsl1, {
            get: {
              owner: '0x878bC2f3f717766ab69C0A5f9A6144931E61AEd3',
              resolver: '0x878bC2f3f717766ab69C0A5f9A6144931E61AEd3',
              records: {
                'crypto.ETH.address':
                  '0x8aaD44321A86b170879d7A244c1e8d360c99DdA8',
              },
              location: UnsLocation.Layer1,
            },
          });
          const unsL2GetMock = mockAsyncMethods(unsl2, {
            get: {
              owner: NullAddress,
              resolver: NullAddress,
              records: {},
              location: UnsLocation.Layer2,
            },
          });
          mockAsyncMethod(Networking, 'fetch', {
            ok: true,
            json: () => ({
              name: 'brad.crypto',
              properties: {records: {}},
            }),
          });
          const endpoint =
            'https://metadata.staging.unstoppabledomains.com/metadata/';

          mockAsyncMethod(uns, 'getTokenUri', endpoint);

          const znsAllRecordsMock = mockAsyncMethods(zns, {
            resolver: 'zil1jcgu2wlx6xejqk9jw3aaankw6lsjzeunx2j0jz',
            getResolverRecords: {
              'crypto.ZIL.address':
                'zil1yu5u4hegy9v3xgluweg4en54zm8f8auwxu0xxj',
            },
          });
          const znsRecords = await resolution.allRecords('brad.zil');
          const unsRecords = await resolution.allRecords('brad.crypto');
          expectSpyToBeCalled(znsAllRecordsMock);
          expectSpyToBeCalled(unsL1GetMock);
          expectSpyToBeCalled(unsL2GetMock);
          expect(unsRecords['crypto.ETH.address']).toEqual(
            '0x8aaD44321A86b170879d7A244c1e8d360c99DdA8',
          );
          expect(znsRecords['crypto.ZIL.address']).toEqual(
            'zil1yu5u4hegy9v3xgluweg4en54zm8f8auwxu0xxj',
          );
        });
      });

      describe('.Dweb', () => {
        describe('.IPFS', () => {
          it('checks return of IPFS hash for brad.zil', async () => {
            const spies = mockAsyncMethods(zns, {
              allRecords: {
                'ipfs.html.value':
                  'QmVaAtQbi3EtsfpKoLzALm6vXphdi2KjMgxEDKeGg6wHuK',
                'whois.email.value': 'derainberk@gmail.com',
                'crypto.BCH.address':
                  'qrq4sk49ayvepqz7j7ep8x4km2qp8lauvcnzhveyu6',
                'crypto.BTC.address': '1EVt92qQnaLDcmVFtHivRJaunG2mf2C3mB',
                'crypto.ETH.address':
                  '0x45b31e01AA6f42F0549aD482BE81635ED3149abb',
                'crypto.LTC.address': 'LetmswTW3b7dgJ46mXuiXMUY17XbK29UmL',
                'crypto.XMR.address':
                  '447d7TVFkoQ57k3jm3wGKoEAkfEym59mK96Xw5yWamDNFGaLKW5wL2qK5RMTDKGSvYfQYVN7dLSrLdkwtKH3hwbSCQCu26d',
                'crypto.ZEC.address': 't1h7ttmQvWCSH1wfrcmvT4mZJfGw2DgCSqV',
                'crypto.ZIL.address':
                  'zil1yu5u4hegy9v3xgluweg4en54zm8f8auwxu0xxj',
                'crypto.DASH.address': 'XnixreEBqFuSLnDSLNbfqMH1GsZk7cgW4j',
                'ipfs.redirect_domain.value': 'www.unstoppabledomains.com',
                'crypto.USDT.version.ERC20.address':
                  '0x8aaD44321A86b170879d7A244c1e8d360c99DdA8',
              },
            });
            const hash = await resolution.ipfsHash('testing.zil');
            expectSpyToBeCalled(spies);
            expect(hash).toBe('QmVaAtQbi3EtsfpKoLzALm6vXphdi2KjMgxEDKeGg6wHuK');
          });
        });

        describe('.Gundb', () => {
          it('should resolve gundb chat id', async () => {
            const eyes = mockAsyncMethods(uns, {
              get: {
                resolver: '0x878bC2f3f717766ab69C0A5f9A6144931E61AEd3',
                records: {
                  ['gundb.username.value']:
                    '0x47992daf742acc24082842752fdc9c875c87c56864fee59d8b779a91933b159e48961566eec6bd6ce3ea2441c6cb4f112d0eb8e8855cc9cf7647f0d9c82f00831c',
                },
              },
            });
            const gundb = await resolution.chatId('homecakes.crypto');
            expectSpyToBeCalled(eyes);
            expect(gundb).toBe(
              '0x47992daf742acc24082842752fdc9c875c87c56864fee59d8b779a91933b159e48961566eec6bd6ce3ea2441c6cb4f112d0eb8e8855cc9cf7647f0d9c82f00831c',
            );
          });
        });
      });

      describe('.Verifications', () => {
        describe('.Twitter', () => {
          it('should return verified twitter handle', async () => {
            const readerSpies = mockAsyncMethods(uns, {
              get: {
                resolver: '0x95AE1515367aa64C462c71e87157771165B1287A',
                owner: '0x499dd6d875787869670900a2130223d85d4f6aa7',
                records: {
                  ['validation.social.twitter.username']:
                    '0x01882395ce631866b76f43535843451444ef4a8ff44db0a9432d5d00658a510512c7519a87c78ba9cad7553e26262ada55c254434a1a3784cd98d06fb4946cfb1b',
                  ['social.twitter.username']: 'Marlene12Bob',
                },
              },
            });
            const twitterHandle = await resolution.twitter(
              CryptoDomainWithTwitterVerification,
            );
            expectSpyToBeCalled(readerSpies);
            expect(twitterHandle).toBe('Marlene12Bob');
          });

          it('should throw unsupported method', async () => {
            const resolution = new Resolution();
            await expectResolutionErrorCode(
              resolution.twitter('ryan.zil'),
              ResolutionErrorCode.UnsupportedMethod,
            );
          });
        });
      });
    });
  });

  describe('.registryAddress', () => {
    it('should return zns mainnet registry address', async () => {
      const registryAddress = await resolution.registryAddress('testi.zil');
      expect(registryAddress).toBe(
        'zil1hyj6m5w4atcn7s806s69r0uh5g4t84e8gp6nps',
      );
    });

    it('should return cns mainnet registry address #1', async () => {
      const spies = mockAsyncMethods(uns, {
        registryAddress: UnsConfig.networks[4].contracts.CNSRegistry.address,
      });
      const registryAddress = await resolution.registryAddress(
        'udtestdev-crewe.crypto',
      );
      expectSpyToBeCalled(spies);
      expect(registryAddress).toBe(
        UnsConfig.networks[4].contracts.CNSRegistry.address,
      );
    });

    it('should return uns mainnet registry address', async () => {
      const spies = mockAsyncMethods(uns, {
        registryAddress: UnsConfig.networks[4].contracts.UNSRegistry.address,
      });
      const registryAddress = await resolution.registryAddress(
        'udtestdev-check.wallet',
      );
      expectSpyToBeCalled(spies);
      expect(registryAddress).toBe(
        UnsConfig.networks[4].contracts.UNSRegistry.address,
      );
    });
    it('should return uns l2 mainnet registry address if domain exists on both', async () => {
      const spies = mockAsyncMethods(uns.unsl1, {
        registryAddress: UnsConfig.networks[4].contracts.UNSRegistry.address,
      });
      const spies2 = mockAsyncMethods(uns.unsl2, {
        registryAddress:
          UnsConfig.networks[80001].contracts.UNSRegistry.address,
      });
      const registryAddress = await resolution.registryAddress(
        WalletDomainOnBothLayers,
      );
      expectSpyToBeCalled(spies);
      expectSpyToBeCalled(spies2);
      expect(registryAddress).toBe(
        UnsConfig.networks[80001].contracts.UNSRegistry.address,
      );
    });
  });

  describe('.records', () => {
    it('returns l2 records if domain exists on both', async () => {
      const eyes = mockAsyncMethods(uns.unsl1, {
        get: {
          owner: '0x878bC2f3f717766ab69C0A5f9A6144931E61AEd3',
          resolver: '0x878bC2f3f717766ab69C0A5f9A6144931E61AEd3',
          records: {
            'crypto.ADA.address': 'blahblah-dont-care-about-these-records',
            'crypto.ETH.address': 'blahblah-dont-care-about-these-records',
          },
        },
      });
      const eyes2 = mockAsyncMethods(uns.unsl2, {
        get: {
          owner: '0x6EC0DEeD30605Bcd19342f3c30201DB263291589',
          resolver: '0x878bC2f3f717766ab69C0A5f9A6144931E61AEd3',
          records: {
            'crypto.ADA.address':
              'DdzFFzCqrhssjmxkChyAHE9MdHJkEc4zsZe7jgum6RtGzKLkUanN1kPZ1ipVPBLwVq2TWrhmPsAvArcr47Pp1VNKmZTh6jv8ctAFVCkj',
            'crypto.ETH.address': '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
          },
        },
      });
      expect(
        await resolution.records(CryptoDomainWithAllRecords, [
          'crypto.ADA.address',
          'crypto.ETH.address',
        ]),
      ).toEqual({
        'crypto.ADA.address':
          'DdzFFzCqrhssjmxkChyAHE9MdHJkEc4zsZe7jgum6RtGzKLkUanN1kPZ1ipVPBLwVq2TWrhmPsAvArcr47Pp1VNKmZTh6jv8ctAFVCkj',
        'crypto.ETH.address': '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
      });
      expectSpyToBeCalled([...eyes, ...eyes2]);
    });
    it('works', async () => {
      const eyes = mockAsyncMethods(uns, {
        get: {
          owner: '0x6EC0DEeD30605Bcd19342f3c30201DB263291589',
          resolver: '0x878bC2f3f717766ab69C0A5f9A6144931E61AEd3',
          records: {
            'crypto.ADA.address':
              'DdzFFzCqrhssjmxkChyAHE9MdHJkEc4zsZe7jgum6RtGzKLkUanN1kPZ1ipVPBLwVq2TWrhmPsAvArcr47Pp1VNKmZTh6jv8ctAFVCkj',
            'crypto.ETH.address': '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
          },
        },
      });
      expect(
        await resolution.records(CryptoDomainWithAllRecords, [
          'crypto.ADA.address',
          'crypto.ETH.address',
        ]),
      ).toEqual({
        'crypto.ADA.address':
          'DdzFFzCqrhssjmxkChyAHE9MdHJkEc4zsZe7jgum6RtGzKLkUanN1kPZ1ipVPBLwVq2TWrhmPsAvArcr47Pp1VNKmZTh6jv8ctAFVCkj',
        'crypto.ETH.address': '0xe7474D07fD2FA286e7e0aa23cd107F8379085037',
      });
      expectSpyToBeCalled([...eyes]);
    });
  });

  describe('.isRegistered', () => {
    it('should return true', async () => {
      const spies = mockAsyncMethods(uns, {
        get: {
          owner: '0x58cA45E932a88b2E7D0130712B3AA9fB7c5781e2',
          resolver: '0x95AE1515367aa64C462c71e87157771165B1287A',
          records: {
            ['ipfs.html.value']:
              'QmQ38zzQHVfqMoLWq2VeiMLHHYki9XktzXxLYTWXt8cydu',
          },
        },
      });
      const isRegistered = await resolution.isRegistered('brad.crypto');
      expectSpyToBeCalled(spies);
      expect(isRegistered).toBe(true);
    });

    it('should return false', async () => {
      const spies = mockAsyncMethods(uns, {
        get: {
          owner: '',
          resolver: '',
          records: {},
        },
      });
      const isRegistered = await resolution.isRegistered(
        'thisdomainisdefinitelynotregistered123.crypto',
      );
      expectSpyToBeCalled(spies);
      expect(isRegistered).toBe(false);
    });

    it('should return true', async () => {
      const spies = mockAsyncMethods(zns, {
        getRecordsAddresses: ['zil1jcgu2wlx6xejqk9jw3aaankw6lsjzeunx2j0jz'],
      });
      const isRegistered = await resolution.isRegistered('testing.zil');
      expectSpyToBeCalled(spies);
      expect(isRegistered).toBe(true);
    });

    it('should return false', async () => {
      const spies = mockAsyncMethods(zns, {
        getRecordsAddresses: [''],
      });
      const isRegistered = await resolution.isRegistered(
        'thisdomainisdefinitelynotregistered123.zil',
      );
      expectSpyToBeCalled(spies);
      expect(isRegistered).toBe(false);
    });
    it('should return true if registered on l2 but not l1', async () => {
      const spies = mockAsyncMethods(uns.unsl1, {
        get: {
          owner: '',
          resolver: '',
          records: {},
          location: UnsLocation.Layer1,
        },
      });
      const spies2 = mockAsyncMethods(uns.unsl2, {
        get: {
          owner: '0x58cA45E932a88b2E7D0130712B3AA9fB7c5781e2',
          resolver: '0x95AE1515367aa64C462c71e87157771165B1287A',
          records: {},
          location: UnsLocation.Layer2,
        },
      });
      const isRegistered = await resolution.isRegistered(
        WalletDomainLayerTwoWithAllRecords,
      );
      expectSpyToBeCalled(spies);
      expectSpyToBeCalled(spies2);
      expect(isRegistered).toBe(true);
    });
    it('should return true if registered on l1 but not l2', async () => {
      const spies = mockAsyncMethods(uns.unsl1, {
        get: {
          owner: '0x58cA45E932a88b2E7D0130712B3AA9fB7c5781e2',
          resolver: '0x95AE1515367aa64C462c71e87157771165B1287A',
          records: {},
        },
      });
      const spies2 = mockAsyncMethods(uns.unsl2, {
        get: {
          owner: '',
          resolver: '',
          records: {},
        },
      });
      const isRegistered = await resolution.isRegistered(
        CryptoDomainWithAllRecords,
      );
      expectSpyToBeCalled(spies);
      expectSpyToBeCalled(spies2);
      expect(isRegistered).toBe(true);
    });
  });

  describe('.isAvailable', () => {
    it('should return false', async () => {
      const spies = mockAsyncMethods(uns, {
        get: {
          owner: '0x58cA45E932a88b2E7D0130712B3AA9fB7c5781e2',
          resolver: '0x95AE1515367aa64C462c71e87157771165B1287A',
          records: {
            ['ipfs.html.value']:
              'QmQ38zzQHVfqMoLWq2VeiMLHHYki9XktzXxLYTWXt8cydu',
          },
        },
      });
      const isAvailable = await resolution.isAvailable('brad.crypto');
      expectSpyToBeCalled(spies);
      expect(isAvailable).toBe(false);
    });

    it('should return true', async () => {
      const spies = mockAsyncMethods(uns, {
        get: {
          owner: '',
          resolver: '',
          records: {},
        },
      });
      const isAvailable = await resolution.isAvailable(
        'qwdqwdjkqhdkqdqwjd.crypto',
      );
      expectSpyToBeCalled(spies);
      expect(isAvailable).toBe(true);
    });
    it('should return false is available on l1 but not l2', async () => {
      const spies = mockAsyncMethods(uns.unsl1, {
        get: {
          owner: '',
          resolver: '',
          records: {},
        },
      });
      const spies2 = mockAsyncMethods(uns.unsl2, {
        get: {
          owner: '0x58cA45E932a88b2E7D0130712B3AA9fB7c5781e2',
          resolver: '0x95AE1515367aa64C462c71e87157771165B1287A',
          records: {},
        },
      });
      const isAvailable = await resolution.isAvailable(
        CryptoDomainWithAllRecords,
      );
      expectSpyToBeCalled(spies);
      expectSpyToBeCalled(spies2);
      expect(isAvailable).toBe(false);
    });

    it('should return false', async () => {
      const spies = mockAsyncMethods(zns, {
        getRecordsAddresses: ['zil1jcgu2wlx6xejqk9jw3aaankw6lsjzeunx2j0jz'],
      });
      const isAvailable = await resolution.isAvailable('testing.zil');
      expectSpyToBeCalled(spies);
      expect(isAvailable).toBe(false);
    });

    it('should return true', async () => {
      const spies = mockAsyncMethods(zns, {
        getRecordsAddresses: [''],
      });
      const isAvailable = await resolution.isAvailable('ryan.zil');
      expectSpyToBeCalled(spies);
      expect(isAvailable).toBe(true);
    });
  });

  describe('.namehash', () => {
    it('brad.crypto', () => {
      const expectedNamehash =
        '0x756e4e998dbffd803c21d23b06cd855cdc7a4b57706c95964a37e24b47c10fc9';
      const namehash = resolution.namehash('brad.crypto');
      expect(namehash).toEqual(expectedNamehash);
    });

    it('brad.zil', () => {
      const expectedNamehash =
        '0x5fc604da00f502da70bfbc618088c0ce468ec9d18d05540935ae4118e8f50787';
      const namehash = resolution.namehash('brad.zil');
      expect(namehash).toEqual(expectedNamehash);
    });

    it('brad.eth', () => {
      const expectedNamehash =
        '0xe2cb672a04d6270338f15a428216ca714514dc01fdbdd76e97038a8d4080e01c';
      const namehash = resolution.namehash('brad.eth');
      expect(namehash).toEqual(expectedNamehash);
    });
  });

  describe('.childhash', () => {
    it('brad.crypto', () => {
      const expectedNamehash =
        '0x756e4e998dbffd803c21d23b06cd855cdc7a4b57706c95964a37e24b47c10fc9';
      const namehash = resolution.childhash(
        '0x0f4a10a4f46c288cea365fcf45cccf0e9d901b945b9829ccdb54c10dc3cb7a6f',
        'brad',
        NamingServiceName.UNS,
      );
      expect(namehash).toEqual(expectedNamehash);
    });

    it('brad.zil', () => {
      const expectedNamehash =
        '0x5fc604da00f502da70bfbc618088c0ce468ec9d18d05540935ae4118e8f50787';
      const namehash = resolution.childhash(
        '0x9915d0456b878862e822e2361da37232f626a2e47505c8795134a95d36138ed3',
        'brad',
        NamingServiceName.ZNS,
      );
      expect(namehash).toEqual(expectedNamehash);
    });

    it('brad.eth', () => {
      const expectedNamehash =
        '0x96a270260d2f9e37845776c17a47ae9b8b7e7e576b2365afd2e7f30f43e9bb49';
      const namehash = resolution.childhash(
        '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae',
        'beresnev',
        NamingServiceName.ENS,
      );
      expect(namehash).toEqual(expectedNamehash);
    });

    it('should throw error if service is not supported', () => {
      expect(() =>
        resolution.childhash(
          '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae',
          'beresnev',
          'COM' as NamingServiceName,
        ),
      ).toThrowError('Naming service COM is not supported');
    });
  });

  describe('.location', () => {
    it('should get location for uns l1 and l2 domains', async () => {
      const mockValuesL1 = {
        callEth:
          '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000420000000000000000000000000000000000000000000000000000000000000046000000000000000000000000000000000000000000000000000000000000004a000000000000000000000000000000000000000000000000000000000000004e0000000000000000000000000000000000000000000000000000000000000052000000000000000000000000000000000000000000000000000000000000003400000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001e000000000000000000000000000000000000000000000000000000000000000050000000000000000000000007fb83000b8ed59d3ead22f0d584df3a85fbc008600000000000000000000000095ae1515367aa64c462c71e87157771165b1287a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000050000000000000000000000000e43f36e4b986dfbe1a75cacfa60ca2bd44ae962000000000000000000000000499dd6d875787869670900a2130223d85d4f6aa7000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000007fb83000b8ed59d3ead22f0d584df3a85fbc00860000000000000000000000000000000000000000000000000000000000000020000000000000000000000000aad76bea7cfec82927239415bb18d2e93518ecbb000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000',
      };
      const mockValuesL2 = {
        callEth:
          '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000420000000000000000000000000000000000000000000000000000000000000046000000000000000000000000000000000000000000000000000000000000004a000000000000000000000000000000000000000000000000000000000000004e0000000000000000000000000000000000000000000000000000000000000052000000000000000000000000000000000000000000000000000000000000003400000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a93c52e7b6e7054870758e15a1446e769edfb930000000000000000000000002a93c52e7b6e7054870758e15a1446e769edfb930000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000499dd6d875787869670900a2130223d85d4f6aa7000000000000000000000000499dd6d875787869670900a2130223d85d4f6aa70000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000002a93c52e7b6e7054870758e15a1446e769edfb9300000000000000000000000000000000000000000000000000000000000000200000000000000000000000002a93c52e7b6e7054870758e15a1446e769edfb9300000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000',
      };

      mockAsyncMethods(uns.unsl1.readerContract, mockValuesL1);
      mockAsyncMethods(uns.unsl2.readerContract, mockValuesL2);
      mockAsyncMethods(uns, {isSupportedDomain: true});

      const location = await resolution.locations([
        'udtestdev-check.wallet',
        'brad.crypto',
        'udtestdev-test-l2-domain-784391.wallet',
        'udtestdev-test-l1-and-l2-ownership.wallet',
        'testing-domain-doesnt-exist-12345abc.blockchain',
      ]);
      expect(location['udtestdev-check.wallet']).toEqual({
        registryAddress: '0x7fb83000B8eD59D3eAD22f0D584Df3a85fBC0086',
        resolverAddress: '0x7fb83000B8eD59D3eAD22f0D584Df3a85fBC0086',
        networkId: 4,
        blockchain: BlockchainType.ETH,
        ownerAddress: '0x0e43F36e4B986dfbE1a75cacfA60cA2bD44Ae962',
        blockchainProviderUrl:
          'https://rinkeby.infura.io/v3/c4bb906ed6904c42b19c95825fe55f39',
      });
      expect(location['brad.crypto']).toEqual({
        registryAddress: '0xAad76bea7CFEc82927239415BB18D2e93518ecBB',
        resolverAddress: '0x95AE1515367aa64C462c71e87157771165B1287A',
        networkId: 4,
        blockchain: BlockchainType.ETH,
        ownerAddress: '0x499dD6D875787869670900a2130223D85d4F6Aa7',
        blockchainProviderUrl:
          'https://rinkeby.infura.io/v3/c4bb906ed6904c42b19c95825fe55f39',
      });
      expect(location['udtestdev-test-l2-domain-784391.wallet']).toEqual({
        registryAddress: '0x2a93C52E7B6E7054870758e15A1446E769EdfB93',
        resolverAddress: '0x2a93C52E7B6E7054870758e15A1446E769EdfB93',
        networkId: 80001,
        blockchain: BlockchainType.MATIC,
        ownerAddress: '0x499dD6D875787869670900a2130223D85d4F6Aa7',
        blockchainProviderUrl:
          'https://polygon-mumbai.infura.io/v3/c4bb906ed6904c42b19c95825fe55f39',
      });
      expect(location['udtestdev-test-l1-and-l2-ownership.wallet']).toEqual({
        registryAddress: '0x2a93C52E7B6E7054870758e15A1446E769EdfB93',
        resolverAddress: '0x2a93C52E7B6E7054870758e15A1446E769EdfB93',
        networkId: 80001,
        blockchain: BlockchainType.MATIC,
        ownerAddress: '0x499dD6D875787869670900a2130223D85d4F6Aa7',
        blockchainProviderUrl:
          'https://polygon-mumbai.infura.io/v3/c4bb906ed6904c42b19c95825fe55f39',
      });
      expect(
        location['testing-domain-doesnt-exist-12345abc.blockchain'],
      ).toBeNull();
    });

    it('should get location for zns domains', async () => {
      await expectResolutionErrorCode(
        () => resolution.locations(['testing.zil']),
        ResolutionErrorCode.UnsupportedMethod,
      );
    });
  });
});
