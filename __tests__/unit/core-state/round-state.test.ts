import { Container, Enums } from "@packages/core-kernel";
import { RoundState } from "@packages/core-state/src/round-state";
import { Sandbox } from "@packages/core-test-framework";
import { Blocks, Identities, Utils } from "@packages/crypto";

import block1760000 from "./__fixtures__/block1760000";

let sandbox: Sandbox;
let roundState: RoundState;

let databaseService;
let dposState;
let getDposPreviousRoundState;
let stateStore;
let walletRepository;
let triggerService;
let eventDispatcher;
let logger;

beforeEach(() => {
    databaseService = {
        getLastBlock: jest.fn(),
        getBlocks: jest.fn(),
        getRound: jest.fn(),
        saveRound: jest.fn(),
        deleteRound: jest.fn(),
    };
    dposState = {
        buildDelegateRanking: jest.fn(),
        setDelegatesRound: jest.fn(),
        getRoundDelegates: jest.fn(),
    };
    getDposPreviousRoundState = jest.fn();
    stateStore = {
        setGenesisBlock: jest.fn(),
        getGenesisBlock: jest.fn(),
        setLastBlock: jest.fn(),
        getLastBlock: jest.fn(),
        getLastBlocksByHeight: jest.fn(),
        getCommonBlocks: jest.fn(),
        getLastBlockIds: jest.fn(),
    };
    walletRepository = {
        createWallet: jest.fn(),
        findByPublicKey: jest.fn(),
        findByUsername: jest.fn(),
    };
    triggerService = {
        call: jest.fn(),
    };
    eventDispatcher = {
        call: jest.fn(),
        dispatch: jest.fn(),
    };
    logger = {
        error: jest.fn(),
        warning: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
    };

    sandbox = new Sandbox();

    sandbox.app.bind(Container.Identifiers.DatabaseService).toConstantValue(databaseService);
    sandbox.app.bind(Container.Identifiers.DposState).toConstantValue(dposState);
    sandbox.app.bind(Container.Identifiers.DposPreviousRoundStateProvider).toConstantValue(getDposPreviousRoundState);
    sandbox.app.bind(Container.Identifiers.StateStore).toConstantValue(stateStore);
    sandbox.app.bind(Container.Identifiers.WalletRepository).toConstantValue(walletRepository);
    sandbox.app.bind(Container.Identifiers.TriggerService).toConstantValue(triggerService);
    sandbox.app.bind(Container.Identifiers.EventDispatcherService).toConstantValue(eventDispatcher);
    sandbox.app.bind(Container.Identifiers.LogService).toConstantValue(logger);

    roundState = sandbox.app.resolve<RoundState>(RoundState);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("RoundState", () => {
    describe("getBlocksForRound", () => {
        let blocks: any[];

        beforeEach(() => {
            blocks = [];

            for (let i = 1; i <= 3; i++) {
                blocks.push({
                    data: {
                        height: i,
                        id: "id_" + i,
                        generatorPublicKey: "public_key_" + i,
                    },
                } as any);
            }
        });

        it("should return array of blocks when all requested blocks are in stateStore", async () => {
            const lastBlock = blocks[2];

            stateStore.getLastBlock.mockReturnValue(lastBlock);
            stateStore.getLastBlocksByHeight.mockReturnValue(blocks);

            // @ts-ignore
            const spyOnFromData = jest.spyOn(Blocks.BlockFactory, "fromData").mockImplementation((block) => {
                return block;
            });

            // @ts-ignore
            await expect(roundState.getBlocksForRound()).resolves.toEqual(blocks);

            await expect(stateStore.getLastBlocksByHeight).toHaveBeenCalledWith(1, 3);
            await expect(spyOnFromData).toHaveBeenCalledTimes(3);
        });

        it("should return array of blocks when only last block is in stateStore", async () => {
            const lastBlock = blocks[2];

            stateStore.getLastBlock.mockReturnValue(lastBlock);
            stateStore.getLastBlocksByHeight.mockReturnValue([lastBlock]);
            databaseService.getBlocks.mockResolvedValue(blocks.slice(0, 2));

            // @ts-ignore
            const spyOnFromData = jest.spyOn(Blocks.BlockFactory, "fromData").mockImplementation((block) => {
                return block;
            });

            // @ts-ignore
            await expect(roundState.getBlocksForRound()).resolves.toEqual(blocks);

            await expect(stateStore.getLastBlocksByHeight).toHaveBeenCalledWith(1, 3);
            await expect(databaseService.getBlocks).toHaveBeenCalledWith(1, 2);
            await expect(spyOnFromData).toHaveBeenCalledTimes(3);
        });
    });

    describe("getActiveDelegates", () => {
        it("should return shuffled round delegates", async () => {
            const lastBlock = Blocks.BlockFactory.fromData(block1760000);
            stateStore.getLastBlock.mockReturnValue(lastBlock);

            const delegatePublicKey = "03287bfebba4c7881a0509717e71b34b63f31e40021c321f89ae04f84be6d6ac37";
            const delegateVoteBalance = Utils.BigNumber.make("100");
            const roundDelegateModel = { publicKey: delegatePublicKey, balance: delegateVoteBalance };
            databaseService.getRound.mockResolvedValueOnce([roundDelegateModel]);

            const newDelegateWallet = { setAttribute: jest.fn(), clone: jest.fn() };
            walletRepository.createWallet.mockReturnValueOnce(newDelegateWallet);

            const oldDelegateWallet = { getAttribute: jest.fn() };
            walletRepository.findByPublicKey.mockReturnValueOnce(oldDelegateWallet);

            const delegateUsername = "test_delegate";
            oldDelegateWallet.getAttribute.mockReturnValueOnce(delegateUsername);

            const cloneDelegateWallet = {};
            newDelegateWallet.clone.mockReturnValueOnce(cloneDelegateWallet);

            // @ts-ignore
            const spyOnShuffleDelegates = jest.spyOn(roundState, "shuffleDelegates");

            await roundState.getActiveDelegates();

            expect(walletRepository.findByPublicKey).toBeCalledWith(delegatePublicKey);
            expect(walletRepository.createWallet).toBeCalledWith(Identities.Address.fromPublicKey(delegatePublicKey));
            expect(oldDelegateWallet.getAttribute).toBeCalledWith("delegate.username");
            expect(newDelegateWallet.setAttribute).toBeCalledWith("delegate", {
                voteBalance: delegateVoteBalance,
                username: delegateUsername,
                round: 34510,
            });
            expect(newDelegateWallet.clone).toBeCalled();
            expect(spyOnShuffleDelegates).toBeCalled();
        });

        it("should return cached forgingDelegates when round is the same", async () => {
            const forgingDelegate = { getAttribute: jest.fn() };
            const forgingDelegateRound = 2;
            forgingDelegate.getAttribute.mockReturnValueOnce(forgingDelegateRound);
            // @ts-ignore
            roundState.forgingDelegates = [forgingDelegate] as any;

            const roundInfo = { round: 2 };
            const result = await roundState.getActiveDelegates(roundInfo as any);

            expect(forgingDelegate.getAttribute).toBeCalledWith("delegate.round");
            // @ts-ignore
            expect(result).toBe(roundState.forgingDelegates);
        });
    });

    describe("setForgingDelegatesOfRound", () => {
        it("should call getActiveDelegates and set forgingDelegatesOfRound", async () => {
            const delegate = {
                username: "dummy_delegate",
            };
            triggerService.call.mockResolvedValue([delegate]);

            const roundInfo = { round: 2, roundHeight: 2, nextRound: 3, maxDelegates: 51 };
            // @ts-ignore
            await roundState.setForgingDelegatesOfRound(roundInfo, [delegate]);

            expect(triggerService.call).toHaveBeenCalledWith("getActiveDelegates", {
                delegates: [delegate],
                roundInfo,
            });

            // @ts-ignore
            expect(roundState.forgingDelegates).toEqual([delegate]);
        });

        it("should call getActiveDelegates and set forgingDelegatesOfRound to [] if undefined is returned", async () => {
            const delegate = {
                username: "dummy_delegate",
            };
            triggerService.call.mockResolvedValue(undefined);

            const roundInfo = { round: 2, roundHeight: 2, nextRound: 3, maxDelegates: 51 };
            // @ts-ignore
            await roundState.setForgingDelegatesOfRound(roundInfo, [delegate]);

            expect(triggerService.call).toHaveBeenCalledWith("getActiveDelegates", {
                delegates: [delegate],
                roundInfo,
            });

            // @ts-ignore
            expect(roundState.forgingDelegates).toEqual([]);
        });
    });

    // describe("revertRound", () => {
    //     it("should revert, and delete round when reverting to previous round", async () => {
    //         const lastBlock = Blocks.BlockFactory.fromData(block1760000);
    //         // @ts-ignore
    //         jest.spyOn(roundState, "getBlocksForRound").mockResolvedValue([lastBlock.data]);
    //
    //         const prevRoundState = { getAllDelegates: jest.fn(), getRoundDelegates: jest.fn(), revert: jest.fn() };
    //         getDposPreviousRoundState.mockReturnValueOnce(prevRoundState).mockReturnValueOnce(prevRoundState);
    //
    //         const prevRoundDelegateWallet = { getAttribute: jest.fn() };
    //         const prevRoundDposStateAllDelegates = [prevRoundDelegateWallet];
    //         prevRoundState.getAllDelegates.mockReturnValueOnce(prevRoundDposStateAllDelegates);
    //
    //         const prevRoundDelegateUsername = "test_delegate";
    //         prevRoundDelegateWallet.getAttribute.mockReturnValueOnce(prevRoundDelegateUsername);
    //
    //         const delegateWallet = { setAttribute: jest.fn(), getAttribute: jest.fn() };
    //         walletRepository.findByUsername.mockReturnValueOnce(delegateWallet);
    //
    //         const prevRoundDelegateRank = 1;
    //         prevRoundDelegateWallet.getAttribute.mockReturnValueOnce(prevRoundDelegateRank);
    //
    //         const prevRoundDposStateRoundDelegates = [prevRoundDelegateWallet];
    //         prevRoundState.getRoundDelegates.mockReturnValueOnce(prevRoundDposStateRoundDelegates);
    //
    //         const forgingDelegates = [delegateWallet];
    //         triggerService.call.mockResolvedValue(forgingDelegates);
    //
    //         // @ts-ignore
    //         await roundState.revertRound(51);
    //
    //         expect(getDposPreviousRoundState).toBeCalled();
    //         expect(walletRepository.findByUsername).toBeCalledWith(prevRoundDelegateUsername);
    //         expect(delegateWallet.setAttribute).toBeCalledWith("delegate.rank", prevRoundDelegateRank);
    //         // @ts-ignore
    //         expect(roundState.forgingDelegates).toEqual(forgingDelegates);
    //         expect(databaseService.deleteRound).toBeCalledWith(2);
    //     });
    // });

    describe("detectMissedBlocks", () => {
        const genesisBlocks = {
            data: {
                height: 1,
            },
        };
        let delegates: any[];

        beforeEach(() => {
            delegates = [];

            for (let i = 0; i < 51; i++) {
                delegates.push({
                    publicKey: "public_key_" + i,
                    getAttribute: jest.fn().mockReturnValue("username_" + 1),
                });
            }

            // @ts-ignore
            roundState.forgingDelegates = delegates;
        });

        it("should not detect missed round when stateStore.lastBlock is genesis block", async () => {
            const block = {
                data: {
                    height: 2,
                },
            };

            stateStore.getLastBlock.mockReturnValue(genesisBlocks);

            await roundState.detectMissedBlocks(block as any);

            expect(logger.debug).not.toHaveBeenCalled();
            expect(eventDispatcher.dispatch).not.toHaveBeenCalled();
        });

        it("should not detect missed block if slots are sequential", async () => {
            const block1 = {
                data: {
                    height: 2,
                    timestamp: 8,
                },
            };
            stateStore.getLastBlock.mockReturnValue(block1);

            const block2 = {
                data: {
                    height: 3,
                    timestamp: 2 * 8,
                },
            };
            await roundState.detectMissedBlocks(block2 as any);

            expect(logger.debug).not.toHaveBeenCalled();
            expect(eventDispatcher.dispatch).not.toHaveBeenCalled();
        });

        it("should detect missed block if slots are not sequential", async () => {
            const block1 = {
                data: {
                    height: 2,
                    timestamp: 8,
                },
            };
            stateStore.getLastBlock.mockReturnValue(block1);

            const block2 = {
                data: {
                    height: 3,
                    timestamp: 3 * 8,
                },
            };
            await roundState.detectMissedBlocks(block2 as any);

            expect(logger.debug).toHaveBeenCalledTimes(1);
            expect(eventDispatcher.dispatch).toHaveBeenCalledTimes(1);
            expect(eventDispatcher.dispatch).toHaveBeenCalledWith(Enums.ForgerEvent.Missing, {
                delegate: delegates[2],
            });
        });

        it("should detect only one round if multiple rounds are missing", async () => {
            const block1 = {
                data: {
                    height: 2,
                    timestamp: 8,
                },
            };
            stateStore.getLastBlock.mockReturnValue(block1);

            const block2 = {
                data: {
                    height: 3,
                    timestamp: 102 * 8,
                },
            };
            await roundState.detectMissedBlocks(block2 as any);

            expect(logger.debug).toHaveBeenCalledTimes(51);
            expect(eventDispatcher.dispatch).toHaveBeenCalledTimes(51);
        });
    });

    describe("detectMissedRound", () => {
        let delegates: any[];
        let blocksInCurrentRound: any[];

        beforeEach(() => {
            delegates = [];
            for (let i = 0; i < 3; i++) {
                delegates.push({
                    publicKey: "public_key_" + i,
                    getAttribute: jest.fn().mockReturnValue("username_" + 1),
                });
            }

            // @ts-ignore
            roundState.forgingDelegates = delegates;

            blocksInCurrentRound = [];
            for (let i = 0; i < 3; i++) {
                blocksInCurrentRound.push({
                    data: {
                        generatorPublicKey: "public_key_" + i,
                    },
                });
            }

            walletRepository.findByPublicKey = jest.fn().mockImplementation((publicKey) => {
                return delegates.find((delegate) => delegate.publicKey === publicKey);
            });
        });

        it("should not detect missed round if all delegates forged blocks", () => {
            // @ts-ignore
            roundState.blocksInCurrentRound = blocksInCurrentRound;

            // @ts-ignore
            roundState.detectMissedRound();

            expect(logger.debug).not.toHaveBeenCalled();
            expect(eventDispatcher.dispatch).not.toHaveBeenCalled();
        });

        it("should detect missed round", () => {
            blocksInCurrentRound[2].data.generatorPublicKey = "public_key_1";

            // @ts-ignore
            roundState.blocksInCurrentRound = blocksInCurrentRound;

            // @ts-ignore
            roundState.detectMissedRound();

            expect(logger.debug).toHaveBeenCalledTimes(1);
            expect(eventDispatcher.dispatch).toHaveBeenCalledWith(Enums.RoundEvent.Missed, { delegate: delegates[2] });
        });
    });

    describe("applyRound", () => {
        it("should build delegates, save round, dispatch events when height is 1", async () => {
            const forgingDelegate = { getAttribute: jest.fn() };
            const forgingDelegateRound = 1;
            forgingDelegate.getAttribute.mockReturnValueOnce(forgingDelegateRound);
            // @ts-ignore
            roundState.forgingDelegates = [forgingDelegate] as any;

            // @ts-ignore
            roundState.blocksInCurrentRound = [];

            const delegateWallet = { publicKey: "delegate public key", getAttribute: jest.fn() };
            const dposStateRoundDelegates = [delegateWallet];
            dposState.getRoundDelegates.mockReturnValueOnce(dposStateRoundDelegates);
            dposState.getRoundDelegates.mockReturnValueOnce(dposStateRoundDelegates);

            const delegateWalletRound = 1;
            delegateWallet.getAttribute.mockReturnValueOnce(delegateWalletRound);

            walletRepository.findByPublicKey.mockReturnValueOnce(delegateWallet);

            const delegateUsername = "test_delegate";
            delegateWallet.getAttribute.mockReturnValueOnce(delegateUsername);

            const height = 1;
            // @ts-ignore
            await roundState.applyRound(height);

            expect(dposState.buildDelegateRanking).toBeCalled();
            expect(dposState.setDelegatesRound).toBeCalledWith({
                round: 1,
                nextRound: 1,
                roundHeight: 1,
                maxDelegates: 51,
            });
            expect(databaseService.saveRound).toBeCalledWith(dposStateRoundDelegates);
            expect(eventDispatcher.dispatch).toBeCalledWith("round.applied");
        });

        it("should build delegates, save round, dispatch events, and skip missing round checks when first round has genesis block only", async () => {
            const forgingDelegate = { getAttribute: jest.fn() };
            const forgingDelegateRound = 1;
            forgingDelegate.getAttribute.mockReturnValueOnce(forgingDelegateRound);
            // @ts-ignore
            roundState.forgingDelegates = [forgingDelegate] as any;

            // @ts-ignore
            roundState.blocksInCurrentRound = [{ data: { height: 1 } }] as any;

            const delegateWallet = { publicKey: "delegate public key", getAttribute: jest.fn() };
            const dposStateRoundDelegates = [delegateWallet];
            dposState.getRoundDelegates.mockReturnValueOnce(dposStateRoundDelegates);
            dposState.getRoundDelegates.mockReturnValueOnce(dposStateRoundDelegates);

            const delegateWalletRound = 2;
            delegateWallet.getAttribute.mockReturnValueOnce(delegateWalletRound);

            walletRepository.findByPublicKey.mockReturnValueOnce(delegateWallet);

            const delegateUsername = "test_delegate";
            delegateWallet.getAttribute.mockReturnValueOnce(delegateUsername);

            const height = 51;
            // @ts-ignore
            await roundState.applyRound(height);

            expect(dposState.buildDelegateRanking).toBeCalled();
            expect(dposState.setDelegatesRound).toBeCalledWith({
                round: 2,
                nextRound: 2,
                roundHeight: 52,
                maxDelegates: 51,
            });
            expect(databaseService.saveRound).toBeCalledWith(dposStateRoundDelegates);
            expect(eventDispatcher.dispatch).toBeCalledWith("round.applied");
        });

        // it("should delete round and rethrow error when error was thrown", async () => {
        //     dposState.buildDelegateRanking.mockImplementation(() => {
        //         throw new Error("Fail");
        //     });
        //
        //     // @ts-ignore
        //     await expect(roundState.applyRound(51)).rejects.toThrowError("Fail");
        //
        //     expect(databaseService.deleteRound).toBeCalledWith(2);
        // });

        it("should do nothing when next height is same round", async () => {
            // @ts-ignore
            await roundState.applyRound(50);
            expect(logger.info).not.toBeCalled();
        });

        // it("should warn when, and do nothing when round was already applied", async () => {
        //     const forgingDelegate = { getAttribute: jest.fn() };
        //     const forgingDelegateRound = 2;
        //     forgingDelegate.getAttribute.mockReturnValueOnce(forgingDelegateRound);
        //     // @ts-ignore
        //     roundState.forgingDelegates = [forgingDelegate] as any;
        //
        //     // @ts-ignore
        //     await roundState.applyRound(51);
        //
        //     expect(logger.warning).toBeCalledWith(
        //         "Round 2 has already been applied. This should happen only if you are a forger.",
        //     );
        // });
    });

    describe("applyBlock", () => {
        let delegates: any[];

        beforeEach(() => {
            delegates = [];
            for (let i = 1; i <= 51; i++) {
                const delegete = {
                    publicKey: "public_key_" + i,
                    getAttribute: jest.fn().mockReturnValue("username_" + 1),
                } as any;

                delegete.clone = () => {
                    return delegete;
                };
                delegates.push(delegete);
            }

            // @ts-ignore
            roundState.forgingDelegates = delegates;
        });

        it("should push block to blocksInCurrentRound and skip applyRound when block is not last block in round", async () => {
            const block = {
                data: {
                    height: 52, // First block in round 2
                },
            };

            // @ts-ignore
            expect(roundState.blocksInCurrentRound).toEqual([]);

            await roundState.applyBlock(block as any);

            // @ts-ignore
            expect(roundState.blocksInCurrentRound).toEqual([block]);
            expect(databaseService.saveRound).not.toHaveBeenCalled();
        });

        it("should push block to blocksInCurrentRound, applyRound, check missing round, calculate delegates, and clear blocksInCurrentRound when block is last in round", async () => {
            for (let i = 1; i < 51; i++) {
                // @ts-ignore
                roundState.blocksInCurrentRound.push({
                    data: {
                        height: i,
                        generatorPublicKey: "public_key_" + i,
                    },
                } as any);
            }

            const block = {
                data: {
                    height: 51, // Last block in round 1
                    generatorPublicKey: "public_key_51",
                },
            };

            dposState.getRoundDelegates.mockReturnValue(delegates);
            triggerService.call.mockImplementation((name, args) => {
                return roundState.getActiveDelegates(args.roundInfo, args.delegates);
            });

            // @ts-ignore
            const spyOnShuffleDelegates = jest.spyOn(roundState, "shuffleDelegates");
            // @ts-ignore
            const spyOnDetectMissedRound = jest.spyOn(roundState, "detectMissedRound");

            // @ts-ignore
            expect(roundState.blocksInCurrentRound.length).toEqual(50);

            await roundState.applyBlock(block as any);

            // @ts-ignore
            expect(roundState.blocksInCurrentRound).toEqual([]);
            expect(databaseService.saveRound).toHaveBeenCalled();
            expect(eventDispatcher.dispatch).toHaveBeenCalledWith(Enums.RoundEvent.Applied);
            expect(spyOnShuffleDelegates).toHaveBeenCalled();
            expect(spyOnDetectMissedRound).toHaveBeenCalled();

            expect(eventDispatcher.dispatch).not.toHaveBeenCalledWith(Enums.RoundEvent.Missed);
        });

        // TODO: Check genesisBlock if required

        // TODO: Should throw error on error with DB connection
    });

    describe("revertBlock", () => {
        it("should remove last block from blocksInCurrentRound when block is in the same round", async () => {
            const block = {
                data: {
                    height: 52, // First block of round 2
                },
            } as any;

            // @ts-ignore
            roundState.blocksInCurrentRound = [block];

            await roundState.revertBlock(block);

            // @ts-ignore
            expect(roundState.blocksInCurrentRound).toEqual([]);
            expect(databaseService.deleteRound).not.toHaveBeenCalled();
        });

        it("should restore previous round, load previousRoundBlocks and delegates, remove last round from DB and remove last block from blocksInCurrentRound if block is last in round", async () => {
            const blocksInPreviousRound: any[] = [];

            for (let i = 1; i <= 51; i++) {
                // @ts-ignore
                blocksInPreviousRound.push({
                    data: {
                        height: i,
                        id: "id_" + i,
                        generatorPublicKey: "public_key_" + i,
                    },
                } as any);
            }

            const delegates: any[] = [];
            for (let i = 1; i <= 51; i++) {
                const delegete = {
                    publicKey: "public_key_" + i,
                    balance: 1,
                    getAttribute: jest.fn().mockReturnValue("username_" + 1),
                } as any;

                delegete.clone = () => {
                    return delegete;
                };
                delegates.push(delegete);
            }

            // @ts-ignore
            const spyOnFromData = jest.spyOn(Blocks.BlockFactory, "fromData").mockImplementation((block) => {
                return block;
            });

            const block = blocksInPreviousRound[50];

            stateStore.getLastBlocksByHeight.mockReturnValue(blocksInPreviousRound);
            stateStore.getLastBlock.mockReturnValue(block);

            getDposPreviousRoundState.mockReturnValue({
                getAllDelegates: jest.fn().mockReturnValue(delegates),
                getRoundDelegates: jest.fn().mockReturnValue(delegates),
            });

            const spyOnCalcPreviousActiveDelegates = jest
                // @ts-ignore
                .spyOn(roundState, "calcPreviousActiveDelegates")
                .mockReturnValue(delegates);

            // @ts-ignore
            expect(roundState.blocksInCurrentRound).toEqual([]);

            await roundState.revertBlock(block);

            expect(spyOnCalcPreviousActiveDelegates).toHaveBeenCalledTimes(1);
            expect(spyOnFromData).toHaveBeenCalledTimes(51);
            expect(databaseService.deleteRound).toHaveBeenCalledWith(2);
            // @ts-ignore
            expect(roundState.blocksInCurrentRound.length).toEqual(50);
        });

        // TODO: Should throw error on error with DB connection

        // TODO: Should throw error if last block is not the same
    });

    describe("restore", () => {
        it("should restore blocksInCurrentRound and forgingDelegates when last block in middle of round", async () => {
            const delegates: any[] = [];
            for (let i = 1; i <= 51; i++) {
                delegates.push({
                    publicKey: "public_key_" + i,
                    getAttribute: jest.fn().mockReturnValue("username_" + 1),
                    balance: 1,
                });
            }

            const blocks: any[] = [];
            for (let i = 1; i <= 3; i++) {
                blocks.push({
                    data: {
                        height: i,
                        id: "id_" + i,
                        generatorPublicKey: "public_key_" + i,
                    },
                } as any);
            }

            const lastBlock = blocks[2];

            stateStore.getLastBlock.mockReturnValue(lastBlock);
            stateStore.getLastBlocksByHeight.mockReturnValue(blocks);
            // @ts-ignore
            const spyOnFromData = jest.spyOn(Blocks.BlockFactory, "fromData").mockImplementation((block) => {
                return block;
            });
            triggerService.call.mockResolvedValue(delegates);

            // @ts-ignore
            expect(roundState.blocksInCurrentRound).toEqual([]);
            // @ts-ignore
            expect(roundState.forgingDelegates).toEqual([]);

            await roundState.restore();

            expect(spyOnFromData).toHaveBeenCalledTimes(3);
            expect(databaseService.deleteRound).toHaveBeenCalledWith(2);

            // @ts-ignore
            expect(roundState.blocksInCurrentRound).toEqual(blocks);
            // @ts-ignore
            expect(roundState.forgingDelegates).toEqual(delegates);
        });

        it("should restore blocksInCurrentRound and forgingDelegates when last block is lastBlock of round", async () => {
            const delegates: any[] = [];
            for (let i = 1; i <= 51; i++) {
                delegates.push({
                    publicKey: "public_key_" + i,
                    balance: 1,
                    getAttribute: jest.fn().mockReturnValue("username_" + 1),
                });
            }

            const blocks: any[] = [];
            for (let i = 1; i <= 51; i++) {
                blocks.push({
                    data: {
                        height: i,
                        id: "id_" + i,
                        generatorPublicKey: "public_key_" + i,
                    },
                } as any);
            }

            const lastBlock = blocks[50];

            stateStore.getLastBlock.mockReturnValue(lastBlock);
            stateStore.getLastBlocksByHeight.mockReturnValue(blocks);
            // @ts-ignore
            const spyOnFromData = jest.spyOn(Blocks.BlockFactory, "fromData").mockImplementation((block) => {
                return block;
            });
            dposState.getRoundDelegates.mockReturnValue(delegates);
            triggerService.call.mockResolvedValue(delegates);

            // @ts-ignore
            expect(roundState.blocksInCurrentRound).toEqual([]);
            // @ts-ignore
            expect(roundState.forgingDelegates).toEqual([]);

            await roundState.restore();

            expect(databaseService.deleteRound).toHaveBeenCalledWith(2);
            expect(databaseService.saveRound).toHaveBeenCalledWith(delegates);
            expect(spyOnFromData).toHaveBeenCalledTimes(51);

            expect(eventDispatcher.dispatch).toHaveBeenCalledWith(Enums.RoundEvent.Applied);

            // @ts-ignore
            expect(roundState.blocksInCurrentRound).toEqual([]);
            // @ts-ignore
            expect(roundState.forgingDelegates).toEqual(delegates);
        });

        // TODO: Should throw error on error with DB connection
    });
});
