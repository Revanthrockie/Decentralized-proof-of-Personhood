// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ProofOfPersonhood Soulbound Token (EIP-5192)
/// @notice Non-transferable NFT minted after AI liveness verification
contract SoulboundToken is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    mapping(address => bool) public isVerified;
    mapping(address => uint256) public tokenOfOwner;

    event Locked(uint256 indexed tokenId);

    constructor() ERC721("ProofOfPersonhood", "POP") Ownable(msg.sender) {}

    function mint(address to, string calldata uri) external onlyOwner {
        require(!isVerified[to], "Already verified");
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        isVerified[to] = true;
        tokenOfOwner[to] = tokenId;
        emit Locked(tokenId);
    }

    // EIP-5192: block all transfers after mint
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        require(from == address(0), "Soulbound: non-transferable");
        return super._update(to, tokenId, auth);
    }

    // EIP-5192 interface
    function locked(uint256) external pure returns (bool) {
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }
}
